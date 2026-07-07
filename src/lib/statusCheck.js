import { getClient } from './crm.js';
import { formatTime12h } from './businessHours.js';

// crmSlot is stored as "YYYY-MM-DD HH:MM" (24-hour, unambiguous) — this is
// the one place it's ever shown to a patient, so the 12-hour conversion
// happens here rather than at storage time.
function formatSlotForDisplay(slot) {
  const [date, time] = slot.split(' ');
  return time ? `${date} at ${formatTime12h(time)}` : date;
}

// Deterministic, non-AI resolution of a booking status-check question.
// The model's own "reply" is discarded when status_check is true (see
// formatContract.js) -- this is the real answer, sourced from D1, not a
// narrated guess from conversation memory.
export async function resolveStatusCheck({ tenant, patientPhone, env }) {
  const client = await getClient(tenant.clinicId, patientPhone, env);

  if (!client?.appointment_slot) {
    console.log(`[status:none-on-file] ${tenant.clinicId} ${patientPhone}`);
    return { replyOverride: "I don't see any appointment on file for you yet — would you like to book one?" };
  }

  const pending = client.appointment_slot.includes('(pending confirmation)');
  const slot = client.appointment_slot.replace(' (pending confirmation)', '');
  const treatment = client.treatment_interest ? ` for ${client.treatment_interest}` : '';
  const displaySlot = formatSlotForDisplay(slot);

  console.log(`[status:${pending ? 'pending' : 'confirmed'}] ${tenant.clinicId} ${patientPhone} ${slot}`);

  if (pending) {
    return {
      replyOverride: `Your request${treatment} for ${displaySlot} is noted but not yet confirmed on our calendar — we'll confirm shortly.`
    };
  }

  return { replyOverride: `Yes, you're booked${treatment} on ${displaySlot}.` };
}
