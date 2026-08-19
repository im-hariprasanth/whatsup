const GRAPH_API_VERSION = 'v20.0';

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function mapLeadFieldData(fieldData = []) {
  const out = {};
  for (const item of fieldData) {
    const name = String(item.name || '').toLowerCase();
    const value = Array.isArray(item.values) ? item.values[0] : item.value;
    if (!value) continue;
    if (['full_name', 'name', 'first_name'].includes(name)) out.name = value;
    if (['phone_number', 'phone', 'mobile_number'].includes(name)) out.phone = normalizePhone(value);
  }
  return out;
}

export async function fetchMetaLeadDetails({ leadgenId, token }) {
  const fields = encodeURIComponent('id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name,platform');
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Meta lead fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function saveLead({ tenant, leadgenId, name, phone, source, status = 'new', env }) {
  await env.CRM_DB.prepare(
    `INSERT INTO leads (clinic_id, leadgen_id, phone, name, source, status, follow_up_count)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (clinic_id, leadgen_id) DO UPDATE SET
       phone = COALESCE(excluded.phone, leads.phone),
       name = COALESCE(excluded.name, leads.name),
       source = COALESCE(excluded.source, leads.source),
       status = CASE WHEN leads.status = 'replied' THEN leads.status ELSE excluded.status END,
       updated_at = datetime('now')`
  )
    .bind(tenant.clinicId, leadgenId, phone, name, source, status)
    .run();
}

export async function getLeadById(clinicId, leadgenId, env) {
  return env.CRM_DB.prepare('SELECT * FROM leads WHERE clinic_id = ? AND leadgen_id = ?')
    .bind(clinicId, leadgenId)
    .first();
}

export async function scheduleFollowUp({ clinicId, leadgenId, step, dueAt, env }) {
  await env.CRM_DB.prepare(
    `INSERT INTO lead_followups (clinic_id, leadgen_id, step, due_at, status)
     VALUES (?, ?, ?, ?, 'pending')
     ON CONFLICT (clinic_id, leadgen_id, step) DO UPDATE SET
       due_at = excluded.due_at,
       status = CASE WHEN lead_followups.status = 'sent' THEN 'sent' ELSE 'pending' END`
  )
    .bind(clinicId, leadgenId, step, dueAt)
    .run();
}

export async function markLeadContacted({ clinicId, leadgenId, step, env }) {
  await env.CRM_DB.prepare(
    `UPDATE leads SET
       status = CASE WHEN status = 'replied' THEN status WHEN ? >= 3 THEN 'exhausted' ELSE 'contacted' END,
       follow_up_count = MAX(follow_up_count, ?),
       updated_at = datetime('now')
     WHERE clinic_id = ? AND leadgen_id = ?`
  )
    .bind(step, step, clinicId, leadgenId)
    .run();
}

export async function markFollowUpSent({ clinicId, leadgenId, step, env }) {
  await env.CRM_DB.prepare(
    `UPDATE lead_followups SET status = 'sent', sent_at = datetime('now')
     WHERE clinic_id = ? AND leadgen_id = ? AND step = ?`
  )
    .bind(clinicId, leadgenId, step)
    .run();
}

export async function markLeadReplied({ clinicId, phone, env }) {
  const normalized = normalizePhone(phone);
  await env.CRM_DB.prepare(
    `UPDATE leads SET status = 'replied', updated_at = datetime('now')
     WHERE clinic_id = ? AND phone = ? AND status != 'replied'`
  )
    .bind(clinicId, normalized)
    .run();
  await env.CRM_DB.prepare(
    `UPDATE lead_followups
     SET status = 'cancelled'
     WHERE clinic_id = ?
       AND status = 'pending'
       AND leadgen_id IN (SELECT leadgen_id FROM leads WHERE clinic_id = ? AND phone = ?)`
  )
    .bind(clinicId, clinicId, normalized)
    .run();
}

export async function getDueFollowUps(env, limit = 25) {
  return env.CRM_DB.prepare(
    `SELECT f.clinic_id, f.leadgen_id, f.step, l.phone, l.name, l.status
     FROM lead_followups f
     JOIN leads l ON l.clinic_id = f.clinic_id AND l.leadgen_id = f.leadgen_id
     WHERE f.status = 'pending' AND datetime(f.due_at) <= datetime('now') AND l.status != 'replied'
     ORDER BY datetime(f.due_at) ASC
     LIMIT ?`
  )
    .bind(limit)
    .all();
}

export async function getLeadStats(clinicId, env) {
  const stats = await env.CRM_DB.prepare(
    `SELECT
       COUNT(*) AS total_leads,
       SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS new_today,
       SUM(CASE WHEN follow_up_count > 0 THEN 1 ELSE 0 END) AS contacted,
       SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
       SUM(CASE WHEN status = 'exhausted' THEN 1 ELSE 0 END) AS exhausted
     FROM leads WHERE clinic_id = ?`
  )
    .bind(clinicId)
    .first();
  const recent = await env.CRM_DB.prepare(
    `SELECT name, phone, leadgen_id, source, status, follow_up_count, created_at, updated_at
     FROM leads WHERE clinic_id = ? ORDER BY datetime(created_at) DESC LIMIT 50`
  )
    .bind(clinicId)
    .all();
  return { stats, recent: recent.results || [] };
}
