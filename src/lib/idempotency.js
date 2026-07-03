const SEEN_TTL_SECONDS = 86400; // 24h — comfortably longer than Meta's webhook retry window

// Meta retries webhook delivery on slow/failed acks, which would otherwise
// cause a full reprocess (duplicate Groq call, duplicate WhatsApp send,
// duplicate booking). Reuses the existing HISTORY KV binding with a
// distinct key prefix rather than a new namespace.
export async function claimMessage(messageId, env) {
  const key = `seen:${messageId}`;
  const existing = await env.HISTORY.get(key);
  if (existing) return false;
  await env.HISTORY.put(key, '1', { expirationTtl: SEEN_TTL_SECONDS });
  return true;
}
