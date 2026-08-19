const ACTIVE_STATUSES = ['confirmed', 'pending_confirmation'];

function activePlaceholders() {
  return ACTIVE_STATUSES.map(() => '?').join(', ');
}

export async function countOverlappingAppointments({ clinicId, startAt, endAt, env }) {
  const row = await env.CRM_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM appointments
     WHERE clinic_id = ?
       AND status IN (${activePlaceholders()})
       AND datetime(start_at) < datetime(?)
       AND datetime(end_at) > datetime(?)`
  )
    .bind(clinicId, ...ACTIVE_STATUSES, endAt, startAt)
    .first();
  return Number(row?.count || 0);
}

export async function checkAppointmentConflict({ clinicId, startAt, endAt, capacity = 1, env }) {
  const count = await countOverlappingAppointments({ clinicId, startAt, endAt, env });
  return count >= capacity ? { count, capacity, status: 'full' } : null;
}

export async function createAppointment(appointment, env) {
  const result = await env.CRM_DB.prepare(
    `INSERT INTO appointments (
       clinic_id, patient_phone, patient_name, treatment, date, time,
       duration_minutes, start_at, end_at, status, source, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      appointment.clinicId,
      appointment.patientPhone,
      appointment.patientName || null,
      appointment.treatment || 'Appointment',
      appointment.date,
      appointment.time,
      appointment.durationMinutes || 30,
      appointment.startAt,
      appointment.endAt,
      appointment.status || 'confirmed',
      appointment.source || 'whatsapp_ai',
      appointment.notes || null
    )
    .run();

  console.log(`[d1:appointment-created] clinic=${appointment.clinicId} phone=${appointment.patientPhone} date=${appointment.date} time=${appointment.time} status=${appointment.status || 'confirmed'}`);
  return { id: result.meta?.last_row_id, ...appointment };
}

export async function listAppointments({ clinicId, date, env }) {
  const rows = await env.CRM_DB.prepare(
    `SELECT id, clinic_id, patient_phone, patient_name, treatment, date, time,
            duration_minutes, start_at, end_at, status, source, notes, created_at, updated_at
     FROM appointments
     WHERE clinic_id = ? AND date = ?
     ORDER BY time ASC`
  )
    .bind(clinicId, date)
    .all();
  return rows.results || [];
}

export async function countAppointmentsForDate({ clinicId, date, env }) {
  const row = await env.CRM_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM appointments
     WHERE clinic_id = ? AND date = ? AND status IN (${activePlaceholders()})`
  )
    .bind(clinicId, date, ...ACTIVE_STATUSES)
    .first();
  return Number(row?.count || 0);
}

export async function getLatestAppointmentForPatient({ clinicId, patientPhone, env }) {
  const row = await env.CRM_DB.prepare(
    `SELECT id, clinic_id, patient_phone, patient_name, treatment, date, time,
            duration_minutes, start_at, end_at, status, source, notes, created_at, updated_at
     FROM appointments
     WHERE clinic_id = ?
       AND patient_phone = ?
       AND status IN (${activePlaceholders()})
     ORDER BY date DESC, time DESC
     LIMIT 1`
  )
    .bind(clinicId, patientPhone, ...ACTIVE_STATUSES)
    .first();
  return row || null;
}
