const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Calendar-date weekday is timezone-independent (July 4 2026 is a Saturday
// no matter where you are), so parsing as UTC is safe here even though the
// date/time itself is clinic-local wall-clock, not UTC.
function dayNameFor(dateStr) {
  return DAY_NAMES[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isWithinBusinessHours({ date, time, durationMinutes, businessHours }) {
  if (!businessHours?.days) return false;

  const hours = businessHours.days[dayNameFor(date)];
  if (!hours) return false; // closed that day

  const start = toMinutes(time);
  const end = start + (durationMinutes || 30);
  return start >= toMinutes(hours.open) && end <= toMinutes(hours.close);
}

// Raw {open, close} | null for the requested calendar date — null means
// closed that day. Used by callers that need to build their own phrasing
// (e.g. a patient-facing fallback message) rather than a pre-formatted string.
export function hoursForDay(date, businessHours) {
  if (!businessHours?.days) return null;
  return businessHours.days[dayNameFor(date)] ?? null;
}

export function describeHoursFor(date, businessHours) {
  if (!businessHours?.days) return null;

  const day = dayNameFor(date);
  const hours = businessHours.days[day];
  const label = day[0].toUpperCase() + day.slice(1);
  return hours ? `${label}: ${hours.open}–${hours.close}` : `${label}: closed`;
}
