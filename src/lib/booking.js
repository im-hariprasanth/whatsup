import { isWithinBusinessHours, hoursForDay, formatTime12h } from './businessHours.js';
import { refreshAccessToken } from './googleAuth.js';
import { checkFreeBusy, createEvent } from './googleCalendar.js';
import { getClient } from './crm.js';

const DEFAULT_DURATION_MINUTES = 30;

// Generic degrade-gracefully response, used whenever we can't reach a real
// confirmed/denied outcome (calendar not connected, or a Google API call
// failed) — never a false confirmation, always something a human can follow up on.
function pendingFallback(date, time) {
  return {
    confirmed: false,
    replyOverride: `Thanks — I've noted your request for ${date} at ${formatTime12h(time)}. Our team will confirm your slot shortly.`,
    crmSlot: `${date} ${time} (pending confirmation)`
  };
}

function findTreatment(treatments, name) {
  if (!Array.isArray(treatments) || !name) return null;
  const lower = name.toLowerCase();
  return treatments.find((t) => t.name.toLowerCase() === lower) ?? null;
}

// Converts clinic-local wall-clock date+time into a UTC Date, correctly
// handling the zone's offset (and DST, since it's evaluated at this specific
// instant rather than a fixed constant) without pulling in a timezone library.
// Built entirely on Intl.DateTimeFormat + Date.UTC, both of which are
// explicit about timezone regardless of the runtime's own default zone --
// unlike round-tripping through toLocaleString()/new Date(string), which
// silently breaks in any environment where the host isn't UTC (verified the
// hard way: local `wrangler dev` on a non-UTC host produced a booking off by
// exactly the zone's offset, even though real deployed Workers run in UTC).
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const asUTC = new Date(`${dateStr}T${timeStr}:00Z`);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(asUTC);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  // What asUTC's instant looks like in the target zone, reinterpreted as if
  // those wall-clock numbers were themselves UTC (Date.UTC is always UTC,
  // never dependent on the host system's local timezone).
  const inZoneAsUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  const diff = asUTC.getTime() - inZoneAsUTC;
  return new Date(asUTC.getTime() + diff);
}

// Deterministic, non-AI validation of a slot the assistant is about to
// propose back to the patient (business hours only — freebusy isn't checked
// until the patient actually confirms, so we don't spend a Calendar round
// trip on every "what about Wednesday?" before they've agreed to anything).
// The returned replyOverride always replaces the model's own phrasing, so
// the exact date/time/treatment the patient is shown is the same value the
// code stores as the pending slot — never two independent guesses.
export function resolveProposedSlot({ tenant, proposedSlot }) {
  const { date, time, treatment: treatmentName } = proposedSlot;
  const matchedTreatment = findTreatment(tenant.treatments, treatmentName);
  const durationMinutes = matchedTreatment?.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const treatmentLabel = matchedTreatment?.name || treatmentName || 'that';

  if (
    tenant.businessHours &&
    !isWithinBusinessHours({ date, time, durationMinutes, businessHours: tenant.businessHours })
  ) {
    const hours = hoursForDay(date, tenant.businessHours);
    return {
      valid: false,
      replyOverride: hours
        ? `That time doesn't work — we're open ${formatTime12h(hours.open)}–${formatTime12h(hours.close)} that day. Could you pick another time?`
        : `We're closed that day. Could you pick another day?`
    };
  }

  return {
    valid: true,
    replyOverride: `We have availability on ${date} at ${formatTime12h(time)} for ${treatmentLabel}. Shall I book that for you?`,
    slot: { date, time, treatment: treatmentName }
  };
}

// Deterministic, non-AI resolution of a booking request. Never throws for
// expected branches — callers get {confirmed, replyOverride, crmSlot} and
// decide what to actually send/store. replyOverride is null when the AI's
// own reply (which already assumed success) should stand.
//
// `bookingRequest` should be the code-verified pending slot (see
// pendingSlot.js) whenever one exists for this patient, rather than the
// model's own fresh extraction — verified live that a small model asked to
// recall a slot it proposed one turn earlier can invent a different date
// AND time than what it actually told the patient.
export async function resolveBooking({ tenant, bookingRequest, patientPhone, env, skipNameCheck }) {
  const { date, time, treatment: treatmentName } = bookingRequest;
  const matchedTreatment = findTreatment(tenant.treatments, treatmentName);
  const durationMinutes = matchedTreatment?.durationMinutes ?? DEFAULT_DURATION_MINUTES;

  // A small model re-reading plain-text history can re-emit a booking_request
  // on a later, unrelated turn (e.g. the patient just says "thank you") since
  // nothing in the transcript marks it as already resolved. Without this
  // guard that re-triggers a real calendar write, which then "conflicts"
  // with the event it created a moment earlier and reports a false "slot
  // was just taken" to a patient who already has it confirmed.
  const existingClient = await getClient(tenant.clinicId, patientPhone, env);
  if (existingClient?.appointment_slot === `${date} ${time}`) {
    console.log(`[booking:already-confirmed] ${tenant.clinicId} ${date} ${time}`);
    return { confirmed: true, replyOverride: null, crmSlot: existingClient.appointment_slot };
  }

  // A clinic wants a name attached to every real booking. Ask for it once,
  // deterministically, before ever touching the calendar — the caller is
  // expected to hold the slot pending and re-call with skipNameCheck once
  // the patient's next message supplies it (see handleMessage.js).
  if (!skipNameCheck && !existingClient?.name) {
    console.log(`[booking:needs-name] ${tenant.clinicId} ${date} ${time}`);
    return {
      confirmed: false,
      needsName: true,
      replyOverride: `Great — I can get that booked. Could I get your name for the appointment?`,
      crmSlot: null
    };
  }

  if (
    tenant.businessHours &&
    !isWithinBusinessHours({ date, time, durationMinutes, businessHours: tenant.businessHours })
  ) {
    const hours = hoursForDay(date, tenant.businessHours);
    console.log(`[booking:out-of-hours] ${tenant.clinicId} ${date} ${time}`);
    return {
      confirmed: false,
      replyOverride: hours
        ? `Sorry, that time doesn't work — we're open ${formatTime12h(hours.open)}–${formatTime12h(hours.close)} that day. Could you pick another time?`
        : `Sorry, we're closed that day. Could you pick another day?`,
      crmSlot: null
    };
  }

  if (!tenant.googleCalendar) {
    console.log(`[booking:not-connected] ${tenant.clinicId} ${date} ${time}`);
    return pendingFallback(date, time);
  }

  const timezone = tenant.businessHours?.timezone ?? 'UTC';
  const startUTC = zonedTimeToUtc(date, time, timezone);
  const endUTC = new Date(startUTC.getTime() + durationMinutes * 60000);

  let accessToken;
  try {
    ({ accessToken } = await refreshAccessToken({
      refreshToken: tenant.googleCalendar.refreshToken,
      env
    }));
  } catch (err) {
    console.error(`[booking:refresh-failed] ${tenant.clinicId}`, err);
    return pendingFallback(date, time);
  }

  let conflict;
  try {
    conflict = await checkFreeBusy({
      accessToken,
      calendarId: tenant.googleCalendar.calendarId,
      startUTC: startUTC.toISOString(),
      endUTC: endUTC.toISOString()
    });
  } catch (err) {
    console.error(`[booking:freebusy-failed] ${tenant.clinicId}`, err);
    return pendingFallback(date, time);
  }

  if (conflict) {
    console.log(`[booking:conflict] ${tenant.clinicId} ${date} ${time}`);
    return {
      confirmed: false,
      replyOverride: `Sorry, that slot was just taken. Could you pick another time?`,
      crmSlot: null
    };
  }

  try {
    await createEvent({
      accessToken,
      calendarId: tenant.googleCalendar.calendarId,
      summary: `${treatmentName || 'Appointment'} — WhatsApp booking`,
      description: `Booked via WhatsApp receptionist. Patient: ${patientPhone}`,
      startUTC: startUTC.toISOString(),
      endUTC: endUTC.toISOString()
    });
  } catch (err) {
    console.error(`[booking:create-failed] ${tenant.clinicId}`, err);
    return pendingFallback(date, time);
  }

  console.log(`[booking:confirmed] ${tenant.clinicId} ${date} ${time}`);
  const treatmentLabel = matchedTreatment?.name || treatmentName || 'your appointment';
  return {
    confirmed: true,
    replyOverride: `You're all set — ${treatmentLabel} is confirmed for ${date} at ${formatTime12h(time)}. Looking forward to seeing you!`,
    crmSlot: `${date} ${time}`
  };
}
