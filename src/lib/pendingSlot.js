const PENDING_TTL_SECONDS = 86400; // 24h — matches Meta's customer-service messaging window

// Deterministic memory of the exact slot the assistant last proposed to a
// patient. Exists because the model was verified live to fabricate a
// *different* date/time when asked to recall its own proposal a turn later
// (proposed "2:30 PM Wednesday", then booked "10:30 AM" the following
// Wednesday when the patient just said "yes book it"). Once a slot is
// proposed and verified against business hours, the code remembers it —
// the model is never trusted to re-derive it from plain-text history again.
// Reuses the existing HISTORY KV binding with a distinct key prefix, same
// pattern as idempotency.js's claimMessage.
function pendingKey(clinicId, phone) {
  return `pending:${clinicId}:${phone}`;
}

export async function savePendingSlot(clinicId, phone, slot, env) {
  await env.HISTORY.put(pendingKey(clinicId, phone), JSON.stringify(slot), {
    expirationTtl: PENDING_TTL_SECONDS
  });
}

export async function getPendingSlot(clinicId, phone, env) {
  const raw = await env.HISTORY.get(pendingKey(clinicId, phone));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export async function clearPendingSlot(clinicId, phone, env) {
  await env.HISTORY.delete(pendingKey(clinicId, phone));
}
