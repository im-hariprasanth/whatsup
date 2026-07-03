// Long-term memory (CRM). Only called when Groq's `extract` is non-null, so
// this runs rarely — once per message at most, and usually much less.
// Upsert: a field is only overwritten when the new extract value for it is
// non-null, so a message that only mentions a name doesn't blank out a
// previously-saved treatment_interest.
export async function saveToCRM(clinicId, phone, extract, env) {
  const name = extract.name ?? null;
  const treatmentInterest = extract.treatment_interest ?? null;
  const appointmentSlot = extract.appointment_slot ?? null;
  const notes = extract.notes ?? null;

  await env.CRM_DB.prepare(
    `INSERT INTO clients (clinic_id, phone, name, treatment_interest, appointment_slot, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (clinic_id, phone) DO UPDATE SET
       name = COALESCE(excluded.name, clients.name),
       treatment_interest = COALESCE(excluded.treatment_interest, clients.treatment_interest),
       appointment_slot = COALESCE(excluded.appointment_slot, clients.appointment_slot),
       notes = COALESCE(excluded.notes, clients.notes),
       last_contact = datetime('now')`
  )
    .bind(clinicId, phone, name, treatmentInterest, appointmentSlot, notes)
    .run();
}

// Real lookup for status-check questions ("is my booking confirmed?") --
// callers use this instead of letting the model narrate an answer from
// conversation memory, which has no guarantee of matching what's actually
// on file.
export async function getClient(clinicId, phone, env) {
  return env.CRM_DB.prepare(
    'SELECT name, treatment_interest, appointment_slot, notes FROM clients WHERE clinic_id = ? AND phone = ?'
  )
    .bind(clinicId, phone)
    .first();
}

// --- Alternative long-term memory backends (NOT used — kept for reference only) ---
//
// If a future tenant needs a spreadsheet-friendly or no-code-friendly CRM instead
// of D1, either of these could replace saveToCRM's body. Both are outside the
// fixed tech stack for v1 and would need to be flagged/approved before use.
//
// Supabase (Postgres), upsert via PostgREST:
//
// async function saveToCRMSupabase(clinicId, phone, extract, env) {
//   await fetch(`${env.SUPABASE_URL}/rest/v1/clients?on_conflict=clinic_id,phone`, {
//     method: 'POST',
//     headers: {
//       apikey: env.SUPABASE_SERVICE_KEY,
//       Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
//       'Content-Type': 'application/json',
//       Prefer: 'resolution=merge-duplicates'
//     },
//     body: JSON.stringify({ clinic_id: clinicId, phone, ...extract })
//   });
// }
//
// Google Sheets, via an Apps Script "web app" webhook:
//
// async function saveToCRMSheets(clinicId, phone, extract, env) {
//   await fetch(env.SHEETS_WEBHOOK_URL, {
//     method: 'POST',
//     body: JSON.stringify({ clinicId, phone, ...extract, timestamp: new Date().toISOString() })
//   });
// }
