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

export async function listTenants(env) {
  const tenants = [];
  let cursor;
  do {
    const page = await env.TENANTS.list({ cursor });
    for (const key of page.keys) {
      const tenant = await getTenant(key.name, env);
      if (tenant) tenants.push({ ...tenant, phoneNumberId: key.name });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return tenants;
}

export async function getTenantByClinicId(clinicId, env) {
  const tenants = await listTenants(env);
  return tenants.find((tenant) => tenant.clinicId === clinicId) || null;
}

export async function getTenantByLeadSource({ pageId, formId }, env) {
  const tenants = await listTenants(env);
  return tenants.find((tenant) => {
    if (!tenant.leadAds?.enabled) return false;
    const pageMatches = !tenant.leadAds.pageId || tenant.leadAds.pageId === pageId;
    const formMatches = !tenant.leadAds.formId || tenant.leadAds.formId === formId;
    return pageMatches && formMatches;
  }) || null;
}
