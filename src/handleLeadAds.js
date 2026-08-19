import { getTenantByLeadSource, getTenantByClinicId } from './lib/tenant.js';
import { fetchMetaLeadDetails, getDueFollowUps, getLeadById, mapLeadFieldData, markFollowUpSent, markLeadContacted, saveLead, scheduleFollowUp } from './lib/leads.js';
import { sendTemplate } from './lib/whatsapp.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function extractLeadgenEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen' || !change.value?.leadgen_id) continue;
      events.push({
        leadgenId: change.value.leadgen_id,
        pageId: change.value.page_id || entry.id,
        formId: change.value.form_id,
        raw: change.value
      });
    }
  }
  return events;
}

function sourceFrom(event, details) {
  return [
    details?.campaign_name || details?.campaign_id,
    details?.ad_name || details?.ad_id,
    event.formId && `form:${event.formId}`,
    event.pageId && `page:${event.pageId}`
  ]
    .filter(Boolean)
    .join(' | ');
}

function dueSql(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString().replace('T', ' ').slice(0, 19);
}

function getTemplateConfig(tenant, step) {
  return tenant.leadFollowUps?.templates?.[step - 1] || { name: `keva_followup_${step}`, language: 'en' };
}

async function sendLeadTemplate({ tenant, lead, step }) {
  const template = getTemplateConfig(tenant, step);
  return sendTemplate({ ...tenant, phoneNumberId: tenant.phoneNumberId }, lead.phone, {
    name: template.name,
    language: template.language || 'en',
    components: template.components || []
  });
}

export async function handleLeadAds(payload, env) {
  const events = extractLeadgenEvents(payload);
  if (events.length === 0) return false;

  for (const event of events) {
    const tenant = await getTenantByLeadSource({ pageId: event.pageId, formId: event.formId }, env);
    if (!tenant) {
      console.log(`[leadads:no-tenant] page=${event.pageId} form=${event.formId}`);
      continue;
    }

    const token = tenant.leadAds?.pageAccessToken || tenant.metaToken;
    const details = event.raw.field_data
      ? { ...event.raw, field_data: event.raw.field_data }
      : await fetchMetaLeadDetails({ leadgenId: event.leadgenId, token });
    const fields = mapLeadFieldData(details.field_data);
    if (!fields.phone) {
      console.log(`[leadads:no-phone] ${event.leadgenId}`);
      continue;
    }

    await saveLead({
      tenant,
      leadgenId: event.leadgenId,
      name: fields.name,
      phone: fields.phone,
      source: sourceFrom(event, details),
      status: 'new',
      env
    });

    const lead = await getLeadById(tenant.clinicId, event.leadgenId, env);
    try {
      await sendLeadTemplate({ tenant, lead, step: 1 });
      await markFollowUpSent({ clinicId: tenant.clinicId, leadgenId: event.leadgenId, step: 1, env });
      await markLeadContacted({ clinicId: tenant.clinicId, leadgenId: event.leadgenId, step: 1, env });
    } catch (err) {
      console.error(`[leadads:template-error] clinic=${tenant.clinicId} leadgen_id=${event.leadgenId} step=1`, err);
    }

    await scheduleFollowUp({ clinicId: tenant.clinicId, leadgenId: event.leadgenId, step: 2, dueAt: dueSql(DAY_MS), env });
    await scheduleFollowUp({ clinicId: tenant.clinicId, leadgenId: event.leadgenId, step: 3, dueAt: dueSql(3 * DAY_MS), env });
    console.log(`[leadads:created] clinic=${tenant.clinicId} leadgen_id=${event.leadgenId}`);
  }

  return true;
}

export async function processDueFollowUps(env) {
  const due = await getDueFollowUps(env);
  for (const item of due.results || []) {
    if (item.step > 3 || item.status === 'replied') continue;
    const tenant = await getTenantByClinicId(item.clinic_id, env);
    if (!tenant) continue;
    try {
      await sendLeadTemplate({ tenant, lead: item, step: item.step });
      await markFollowUpSent({ clinicId: item.clinic_id, leadgenId: item.leadgen_id, step: item.step, env });
      await markLeadContacted({ clinicId: item.clinic_id, leadgenId: item.leadgen_id, step: item.step, env });
      console.log(`[followup:sent] clinic=${item.clinic_id} leadgen_id=${item.leadgen_id} step=${item.step}`);
    } catch (err) {
      console.error(`[followup:error] clinic=${item.clinic_id} leadgen_id=${item.leadgen_id} step=${item.step}`, err);
    }
  }
}
