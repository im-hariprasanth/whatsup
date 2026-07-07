import { SALES_FLOW_GUIDANCE, JSON_FORMAT_INSTRUCTIONS } from './formatContract.js';
import { formatTime12h } from '../lib/businessHours.js';

// Renders the tenant's specialty/category list into prompt text. Previously
// this only ever lived inside free-text personaPrompt prose (works, but not
// structured — no consistent way to reference it or reason about it).
// Explicitly instructs the model to stay honest about scope, since a small
// model asked an out-of-specialty question will otherwise happily guess.
function formatSpecialty(specialty) {
  if (!Array.isArray(specialty) || specialty.length === 0) return null;

  return `Specialty: ${specialty.join(', ')}. Only discuss topics within this specialty. If a patient asks about something clearly outside it, say so honestly and briefly rather than guessing or inventing an answer.`;
}

// Renders the tenant's structured treatment list into prompt text, so
// pricing/names come from validated config rather than however well the
// clinic happened to phrase their persona prose. Returns null when the
// tenant has no treatments array (legacy tenants keep relying on prose
// inside personaPrompt, unchanged).
function formatTreatments(treatments) {
  if (!Array.isArray(treatments) || treatments.length === 0) return null;

  const lines = treatments.map((t) => {
    const duration = t.durationMinutes ? ` (${t.durationMinutes} min)` : '';
    const desc = t.description ? ` — ${t.description}` : '';
    return `- ${t.name}: ${t.price}${duration}${desc}`;
  });

  return `Treatments offered:\n${lines.join('\n')}`;
}

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Renders the tenant's structured business hours into prompt text. Returns
// null when businessHours isn't configured — without it there's nothing
// useful to enforce, so the booking flow stays inert for that tenant.
function formatBusinessHours(businessHours) {
  if (!businessHours?.days) return null;

  const lines = DAY_ORDER
    .filter((day) => businessHours.days[day] !== undefined)
    .map((day) => {
      const hours = businessHours.days[day];
      const label = day[0].toUpperCase() + day.slice(1);
      return hours ? `${label}: ${formatTime12h(hours.open)}–${formatTime12h(hours.close)}` : `${label}: closed`;
    });

  if (lines.length === 0) return null;
  return `Business hours (${businessHours.timezone}):\n${lines.join('\n')}`;
}

function formatDateParts(date, timezone, opts) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...opts }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

// Injects the current date/time plus an explicit next-7-days lookup table,
// computed fresh on every call, in the clinic's own timezone. The lookup
// table exists because asking the model to compute weekday arithmetic itself
// ("today is Saturday, so Sunday is +1 day") turned out unreliable in
// practice — verified live, the same phrase "2pm Sunday" resolved to two
// different dates across two separate messages in the same conversation,
// creating two conflicting real calendar bookings. Handing it a literal
// table to read from removes the arithmetic entirely.
function formatTodayContext(timezone) {
  if (!timezone) return null;

  const now = new Date();
  const nowParts = formatDateParts(now, timezone, {
    weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });

  const upcoming = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const dParts = formatDateParts(d, timezone, { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
    const label = i === 0 ? `Today (${dParts.weekday})` : i === 1 ? `Tomorrow (${dParts.weekday})` : dParts.weekday;
    upcoming.push(`${label}: ${dParts.year}-${dParts.month}-${dParts.day}`);
  }

  return `Right now it is ${nowParts.weekday}, ${nowParts.year}-${nowParts.month}-${nowParts.day}, ${nowParts.hour}:${nowParts.minute} clinic-local time.\nUpcoming dates (use this table to resolve a day name into a date — never compute it yourself; if the patient doesn't say "next", use the soonest matching date here):\n${upcoming.join('\n')}`;
}

// Composes the full Groq system prompt for a tenant. Tenant config supplies
// business content (persona, tone, treatments, hours); this function is the
// only place that decides the final shape and ordering, so every tenant gets
// the same structure regardless of what they filled in.
export function buildSystemPrompt(tenant) {
  const sections = [tenant.personaPrompt, SALES_FLOW_GUIDANCE];

  if (tenant.salesStyle) {
    sections.push(`Tone note for this clinic: ${tenant.salesStyle}`);
  }

  const specialtySection = formatSpecialty(tenant.specialty);
  if (specialtySection) {
    sections.push(specialtySection);
  }

  const treatmentsSection = formatTreatments(tenant.treatments);
  if (treatmentsSection) {
    sections.push(treatmentsSection);
  }

  const hoursSection = formatBusinessHours(tenant.businessHours);
  if (hoursSection) {
    sections.push(hoursSection);
  }

  const todayContext = formatTodayContext(tenant.businessHours?.timezone);
  if (todayContext) {
    sections.push(todayContext);
  }

  sections.push(JSON_FORMAT_INSTRUCTIONS);

  return sections.join('\n\n');
}
