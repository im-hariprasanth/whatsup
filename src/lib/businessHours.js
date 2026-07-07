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

// Patient-facing time display only — the internal contract (Groq's
// booking_request.time, business hours storage) stays 24-hour HH:MM
// throughout the system since that's unambiguous to parse. This is purely
// for what gets shown/said to a patient.
export function formatTime12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
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
  return hours ? `${label}: ${formatTime12h(hours.open)}–${formatTime12h(hours.close)}` : `${label}: closed`;
}
