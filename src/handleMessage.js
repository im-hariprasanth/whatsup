import { getTenant } from './lib/tenant.js';
import { getHistory, saveHistory } from './lib/history.js';
import { generateReply } from './lib/groq.js';
import { sendReply } from './lib/whatsapp.js';
import { saveToCRM } from './lib/crm.js';
import { JSON_FORMAT_INSTRUCTIONS } from './prompts/formatContract.js';

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
    { role: 'system', content: `${tenant.personaPrompt}\n\n${JSON_FORMAT_INSTRUCTIONS}` },
    ...history,
    { role: 'user', content: message.text.body }
  ];

  console.log(`[groq:request] ${historyKey}`, JSON.stringify(messages));

  const { reply, extract } = await generateReply(messages, env);

  console.log(`[groq:response] ${historyKey} reply=${reply} extract=${JSON.stringify(extract)}`);

  // Send the reply. A WhatsApp send failure (e.g. an invalid/placeholder token
  // in local dev) shouldn't stop history/CRM writes, so it's logged, not thrown.
  try {
    await sendReply({ ...tenant, phoneNumberId }, patientPhone, reply);
  } catch (err) {
    console.error(`[whatsapp:error] ${historyKey}`, err);
  }

  const updatedHistory = [
    ...history,
    { role: 'user', content: message.text.body },
    { role: 'assistant', content: reply }
  ];
  await saveHistory(historyKey, updatedHistory, env);

  if (extract) {
    await saveToCRM(tenant.clinicId, patientPhone, extract, env);
  }
}
