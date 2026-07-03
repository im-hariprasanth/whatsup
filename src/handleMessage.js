import { getTenant } from './lib/tenant.js';
import { getHistory, saveHistory } from './lib/history.js';
import { generateReply } from './lib/groq.js';
import { sendReply } from './lib/whatsapp.js';
import { saveToCRM } from './lib/crm.js';
import { claimMessage } from './lib/idempotency.js';
import { resolveBooking } from './lib/booking.js';
import { buildSystemPrompt } from './prompts/buildSystemPrompt.js';

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
  const history = await getHistory(historyKey, env);

  const messages = [
    { role: 'system', content: buildSystemPrompt(tenant) },
    ...history,
    { role: 'user', content: message.text.body }
  ];

  console.log(`[groq:request] ${historyKey}`, JSON.stringify(messages));

  const { reply, extract, bookingRequest } = await generateReply(messages, env);

  console.log(`[groq:response] ${historyKey} reply=${reply} extract=${JSON.stringify(extract)}`);

  // finalReply starts as the AI's own reply (which already assumed success);
  // resolveBooking only overrides it when reality disagrees (out of hours,
  // calendar not connected, or a genuine conflict).
  let finalReply = reply;
  let bookingResult = { confirmed: false, crmSlot: null };

  if (bookingRequest) {
    console.log(`[booking:request] ${historyKey}`, JSON.stringify(bookingRequest));
    bookingResult = await resolveBooking({ tenant, bookingRequest, patientPhone, env });
    if (bookingResult.replyOverride) {
      finalReply = bookingResult.replyOverride;
    }
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
    if (bookingResult.crmSlot) {
      finalExtract.appointment_slot = bookingResult.crmSlot;
    }
    await saveToCRM(tenant.clinicId, patientPhone, finalExtract, env);
  }
}
