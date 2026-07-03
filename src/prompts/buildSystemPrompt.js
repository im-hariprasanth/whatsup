import { SALES_FLOW_GUIDANCE, JSON_FORMAT_INSTRUCTIONS } from './formatContract.js';

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
      return hours ? `${label}: ${hours.open}–${hours.close}` : `${label}: closed`;
    });

  if (lines.length === 0) return null;
  return `Business hours (${businessHours.timezone}):\n${lines.join('\n')}`;
}

// Injects the current date/time in the clinic's own timezone, computed fresh
// on every call — without this the model has no real anchor for resolving
// "tomorrow" or "this Saturday" into an actual date.
function formatTodayContext(timezone) {
  if (!timezone) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return `Right now it is ${map.weekday}, ${map.year}-${map.month}-${map.day}, ${map.hour}:${map.minute} clinic-local time. Use this to resolve relative dates like "tomorrow" or "this Saturday".`;
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
