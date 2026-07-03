// TENANTS KV: one entry per clinic, key = phone_number_id, value = tenant config JSON.
// Read-heavy, write-rare — writes only happen during onboarding.

export async function getTenant(phoneNumberId, env) {
  const raw = await env.TENANTS.get(phoneNumberId);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Corrupt tenant config for phone_number_id=${phoneNumberId}`, err);
    return null;
  }
}

export async function putTenant(phoneNumberId, config, env) {
  await env.TENANTS.put(phoneNumberId, JSON.stringify(config));
}
