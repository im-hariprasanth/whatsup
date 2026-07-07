import { getTenant } from './lib/tenant.js';
import { getHistory, saveHistory } from './lib/history.js';
import { generateReply } from './lib/groq.js';
import { sendReply } from './lib/whatsapp.js';
import { saveToCRM } from './lib/crm.js';
import { claimMessage } from './lib/idempotency.js';
import { resolveBooking, resolveProposedSlot } from './lib/booking.js';
import { resolveStatusCheck } from './lib/statusCheck.js';
import { getPendingSlot, savePendingSlot, clearPendingSlot } from './lib/pendingSlot.js';
import { buildSystemPrompt } from './prompts/buildSystemPrompt.js';

// A clinic wants a real name on every booking, so once resolveBooking asks
// for one, the entire next message is treated as the answer rather than
// running it through Groq — a name is too low-stakes to need an LLM call,
// and doing it deterministically means it can never get tangled up with the
// booking logic the way a model-driven turn could.
function extractNameFromReply(text) {
  return text.replace(/^(it'?s|my name is|i am|i'?m|this is)\s+/i, '').trim();
}

// Orchestrates one inbound WhatsApp message end to end:
// tenant lookup -> rolling history -> Groq -> WhatsApp reply -> history write -> CRM upsert.
export async function handleMessage(payload, env) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return;

  const phoneNumberId = value.metadata?.phone_number_id;
  const message = value.messages?.[0];

  // No message here means this is a status/delivery/read receipt payload, or
  // something else Meta sends that isn't a customer message. Ignore silently.
  if (!message || !phoneNumberId) return;

  // Meta retries webhook delivery on slow/failed acks. Dedupe on the message's
  // own id before doing any real work, so a retry never double-processes.
  if (!(await claimMessage(message.id, env))) {
    console.log(`[idempotency:duplicate] ${message.id}`);
    return;
  }

  // Only handle plain text messages for v1 (images, audio, stickers, etc. are ignored).
  if (message.type !== 'text' || !message.text?.body) return;

  const tenant = await getTenant(phoneNumberId, env);
  if (!tenant) {
    console.log(`No tenant configured for phone_number_id=${phoneNumberId}`);
    return;
  }

  const patientPhone = message.from;
  const historyKey = `${tenant.clinicId}:${patientPhone}`;
  const pendingSlot = await getPendingSlot(tenant.clinicId, patientPhone, env);

  // We already asked for their name to finish a pending booking — this
  // message is the answer. Skip Groq entirely: complete the booking with
  // the slot the code already verified, deterministically, end to end.
  if (pendingSlot?.awaitingName) {
    const history = await getHistory(historyKey, env);
    const name = extractNameFromReply(message.text.body);
    await saveToCRM(tenant.clinicId, patientPhone, { name }, env);

    const bookingResult = await resolveBooking({
      tenant, bookingRequest: pendingSlot, patientPhone, env, skipNameCheck: true
    });
    const finalReply = bookingResult.replyOverride || `Thanks, ${name}!`;

    try {
      await sendReply({ ...tenant, phoneNumberId }, patientPhone, finalReply);
    } catch (err) {
      console.error(`[whatsapp:error] ${historyKey}`, err);
    }

    await saveHistory(historyKey, [
      ...history,
      { role: 'user', content: message.text.body },
      { role: 'assistant', content: finalReply }
    ], env);

    if (bookingResult.crmSlot) {
      await saveToCRM(tenant.clinicId, patientPhone, { appointment_slot: bookingResult.crmSlot }, env);
    }
    await clearPendingSlot(tenant.clinicId, patientPhone, env);
    return;
  }

  const history = await getHistory(historyKey, env);

  const messages = [
    { role: 'system', content: buildSystemPrompt(tenant) },
    ...history,
    { role: 'user', content: message.text.body }
  ];

  console.log(`[groq:request] ${historyKey}`, JSON.stringify(messages));

  const { reply, extract, bookingRequest, statusCheck, proposedSlot } = await generateReply(messages, env);

  console.log(`[groq:response] ${historyKey} reply=${reply} extract=${JSON.stringify(extract)}`);

  // finalReply starts as the AI's own reply (which already assumed success);
  // resolveBooking/resolveStatusCheck only override it when reality disagrees
  // (out of hours, calendar not connected, a genuine conflict) or when the
  // model's own reply was never grounded in real data to begin with (status
  // checks are never answered by the model itself — see formatContract.js).
  let finalReply = reply;
  let bookingResult = { confirmed: false, crmSlot: null };

  if (proposedSlot) {
    // The model is offering a slot for the first time this turn — verify it
    // and remember it, so the actual confirmation later never has to trust
    // the model to recall its own offer (see resolveProposedSlot's comment).
    console.log(`[booking:proposed] ${historyKey}`, JSON.stringify(proposedSlot));
    const proposal = resolveProposedSlot({ tenant, proposedSlot });
    finalReply = proposal.replyOverride;
    if (proposal.valid) {
      await savePendingSlot(tenant.clinicId, patientPhone, { ...proposal.slot, awaitingName: false }, env);
    }
  } else if (bookingRequest) {
    // Prefer the code-verified pending slot over the model's fresh
    // extraction whenever one exists for this patient.
    const effectiveBookingRequest = pendingSlot ?? bookingRequest;
    console.log(`[booking:request] ${historyKey}`, JSON.stringify(effectiveBookingRequest));
    bookingResult = await resolveBooking({ tenant, bookingRequest: effectiveBookingRequest, patientPhone, env });
    if (bookingResult.needsName) {
      await savePendingSlot(tenant.clinicId, patientPhone, { ...effectiveBookingRequest, awaitingName: true }, env);
    } else {
      await clearPendingSlot(tenant.clinicId, patientPhone, env);
    }
    if (bookingResult.replyOverride) {
      finalReply = bookingResult.replyOverride;
    }
  } else if (statusCheck) {
    console.log(`[status:check] ${historyKey}`);
    const statusResult = await resolveStatusCheck({ tenant, patientPhone, env });
    finalReply = statusResult.replyOverride;
  }

  // Send the reply. A WhatsApp send failure (e.g. an invalid/placeholder token
  // in local dev) shouldn't stop history/CRM writes, so it's logged, not thrown.
  try {
    await sendReply({ ...tenant, phoneNumberId }, patientPhone, finalReply);
  } catch (err) {
    console.error(`[whatsapp:error] ${historyKey}`, err);
  }

  // History stores finalReply, not the raw model reply — if the patient
  // actually received an override, the next turn must see what they saw,
  // or the model desyncs from reality.
  const updatedHistory = [
    ...history,
    { role: 'user', content: message.text.body },
    { role: 'assistant', content: finalReply }
  ];
  await saveHistory(historyKey, updatedHistory, env);

  // crmSlot (precise, structured) beats the model's free-text appointment_slot
  // guess whenever resolveBooking produced one — whether or not the booking
  // ended up truly confirmed, since even a pending/not-yet-connected request
  // is worth clinic staff seeing accurately. `confirmed` stays a separate
  // signal for logging/future logic, not a gate on CRM visibility.
  if (extract || bookingResult.crmSlot) {
    const finalExtract = { ...(extract || {}) };
    // appointment_slot is only ever set from the deterministic booking flow
    // below, never from the model's own free-text extraction — verified live
    // that the model can independently invent a slot value here (unrelated
    // to any real booking) that then overwrites the real one via saveToCRM's
    // upsert.
    delete finalExtract.appointment_slot;
    if (bookingResult.crmSlot) {
      finalExtract.appointment_slot = bookingResult.crmSlot;
    }
    await saveToCRM(tenant.clinicId, patientPhone, finalExtract, env);
  }
}
