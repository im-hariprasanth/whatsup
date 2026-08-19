const TTL_SECONDS = 7 * 24 * 60 * 60;

function key(clinicId, patientPhone) {
  return `state:${clinicId}:${patientPhone}`;
}

export async function getConversationState({ clinicId, patientPhone, env }) {
  const raw = await env.HISTORY.get(key(clinicId, patientPhone));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveConversationState({ clinicId, patientPhone, state, env }) {
  await env.HISTORY.put(
    key(clinicId, patientPhone),
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }),
    { expirationTtl: TTL_SECONDS }
  );
}
