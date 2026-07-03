import { isWithinBusinessHours, hoursForDay } from './businessHours.js';

const DEFAULT_DURATION_MINUTES = 30;

function findTreatment(treatments, name) {
  if (!Array.isArray(treatments) || !name) return null;
  const lower = name.toLowerCase();
  return treatments.find((t) => t.name.toLowerCase() === lower) ?? null;
}

// Deterministic, non-AI resolution of a booking request extracted by Groq.
// Never throws for expected branches — callers get {confirmed, replyOverride,
// crmSlot} and decide what to actually send/store. replyOverride is null
// when the AI's own reply (which already assumed success) should stand.
export async function resolveBooking({ tenant, bookingRequest, env }) {
  const { date, time, treatment: treatmentName } = bookingRequest;
  const matchedTreatment = findTreatment(tenant.treatments, treatmentName);
  const durationMinutes = matchedTreatment?.durationMinutes ?? DEFAULT_DURATION_MINUTES;

  if (
    tenant.businessHours &&
    !isWithinBusinessHours({ date, time, durationMinutes, businessHours: tenant.businessHours })
  ) {
    const hours = hoursForDay(date, tenant.businessHours);
    console.log(`[booking:out-of-hours] ${tenant.clinicId} ${date} ${time}`);
    return {
      confirmed: false,
      replyOverride: hours
        ? `Sorry, that time doesn't work — we're open ${hours.open}–${hours.close} that day. Could you pick another time?`
        : `Sorry, we're closed that day. Could you pick another day?`,
      crmSlot: null
    };
  }

  if (!tenant.googleCalendar) {
    console.log(`[booking:not-connected] ${tenant.clinicId} ${date} ${time}`);
    return {
      confirmed: false,
      replyOverride: `Thanks — I've noted your request for ${date} at ${time}. Our team will confirm your slot shortly.`,
      crmSlot: `${date} ${time} (pending confirmation)`
    };
  }

  // Phase 6 replaces this branch: refresh token -> freebusy check -> create event.
  console.log(`[booking:not-implemented] ${tenant.clinicId} ${date} ${time}`);
  return {
    confirmed: false,
    replyOverride: `Thanks — I've noted your request for ${date} at ${time}. Our team will confirm your slot shortly.`,
    crmSlot: `${date} ${time} (pending confirmation)`
  };
}
