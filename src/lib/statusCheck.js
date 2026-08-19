import { getClient } from './crm.js';
import { getLatestAppointmentForPatient } from './appointments.js';

function formatTime(time) {
  if (!time) return '';
  const [h, m] = String(time).split(':').map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export async function resolveStatusCheck({ tenant, patientPhone, env }) {
  try {
    const appointment = await getLatestAppointmentForPatient({ clinicId: tenant.clinicId, patientPhone, env });
    if (appointment) {
      console.log(`[status:d1:${appointment.status}] ${tenant.clinicId} ${patientPhone} ${appointment.date} ${appointment.time}`);
      const statusText = appointment.status === 'confirmed' ? 'booked' : 'noted but pending confirmation';
      return {
        replyOverride: `Your ${appointment.treatment} appointment is ${statusText} for ${appointment.date} at ${formatTime(appointment.time)}.`
      };
    }
  } catch (err) {
    console.error(`[status:d1-appointment-error] ${tenant.clinicId} ${patientPhone}`, err);
  }

  const client = await getClient(tenant.clinicId, patientPhone, env);

  if (!client?.appointment_slot) {
    console.log(`[status:none-on-file] ${tenant.clinicId} ${patientPhone}`);
    return { replyOverride: "I don't see any appointment on file for you yet — would you like to book one?" };
  }

  const pending = client.appointment_slot.includes('(pending confirmation)');
  const slot = client.appointment_slot.replace(' (pending confirmation)', '');
  const treatment = client.treatment_interest ? ` for ${client.treatment_interest}` : '';

  console.log(`[status:${pending ? 'pending' : 'confirmed'}] ${tenant.clinicId} ${patientPhone} ${slot}`);

  if (pending) {
    return {
      replyOverride: `Your request${treatment} for ${slot} is noted but not yet confirmed — we'll confirm shortly.`
    };
  }

  return { replyOverride: `Yes, you're booked${treatment} on ${slot}.` };
}
