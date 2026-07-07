// HISTORY KV: one entry per active conversation, key = `${clinicId}:${patientPhone}`,
// value = JSON array of chat turns, trimmed to the last 8 (4 exchanges).
//
// This is short-term scratch memory only — durable facts (name, treatment
// interest, notes, appointment slot) live in CRM_DB (D1) instead, so letting
// a conversation's history expire never loses anything worth keeping.

const MAX_HISTORY_LENGTH = 8;

// Every write resets this, so an active back-and-forth never expires — only
// a conversation that's gone quiet for 30 days ages out on its own. Without
// this, every phone number that ever texts the bot stays in KV forever, even
// after they never come back, which grows unbounded across clinics/patients
// with zero cleanup mechanism otherwise. Cloudflare KV expires the key
// natively, so no cron job or manual sweep is needed.
const HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60;

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
  await env.HISTORY.put(key, JSON.stringify(trimmed), { expirationTtl: HISTORY_TTL_SECONDS });
}
