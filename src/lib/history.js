// HISTORY KV: one entry per active conversation, key = `${clinicId}:${patientPhone}`,
// value = JSON array of chat turns, trimmed to the last 8 (4 exchanges).

const MAX_HISTORY_LENGTH = 8;

export async function getHistory(key, env) {
  const raw = await env.HISTORY.get(key);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Corrupt history for key=${key}`, err);
    return [];
  }
}

export async function saveHistory(key, history, env) {
  const trimmed = history.slice(-MAX_HISTORY_LENGTH);
  await env.HISTORY.put(key, JSON.stringify(trimmed));
}
