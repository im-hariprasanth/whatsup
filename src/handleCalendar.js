import { getTenantByClinicId } from './lib/tenant.js';
import { listAppointments } from './lib/appointments.js';
import { requireAuth } from './lib/auth.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function formatLocalDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function appointmentTime(value) {
  if (!value) return '';
  const [h, m] = String(value).split(':').map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export async function handleCalendar(request, env) {
  const authResponse = await requireAuth(request, env);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const clinicId = url.searchParams.get('clinic') || url.searchParams.get('clinicId') || 'bonitaa';
  const tenant = await getTenantByClinicId(clinicId, env);
  if (!tenant) return new Response(`No tenant found for ${clinicId}`, { status: 404 });

  const timezone = tenant.businessHours?.timezone || 'Asia/Kolkata';
  const date = url.searchParams.get('date') || formatLocalDate(new Date(), timezone);
  const appointments = await listAppointments({ clinicId, date, env });

  const rows = appointments.map((appt) => `
    <tr class="border-t border-keva-line/70 hover:bg-keva-soft/40">
      <td class="whitespace-nowrap px-4 py-3 font-semibold text-keva-ink">${escapeHtml(appointmentTime(appt.time))}</td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(appt.patient_name || '—')}</td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(appt.patient_phone)}</td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(appt.treatment)}</td>
      <td class="whitespace-nowrap px-4 py-3"><span class="rounded-full bg-keva-soft px-2.5 py-1 text-xs font-semibold ring-1 ring-keva-line">${escapeHtml(appt.status)}</span></td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(appt.notes || '—')}</td>
    </tr>`).join('');

  const prev = new Date(`${date}T00:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const prevDate = prev.toISOString().slice(0, 10);
  const nextDate = next.toISOString().slice(0, 10);

  const today = formatLocalDate(new Date(), timezone);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keva Calendar</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{keva:{page:'#fffdfb',soft:'#fbf4f0',card:'#f8eee9',line:'#eadbd4',ink:'#241816',muted:'#70645f',brand:'#c75a34',brandDark:'#9f3d1c'}}}}}</script>
</head><body class="min-h-screen bg-keva-page text-keva-ink antialiased">
<main class="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
  <header class="rounded-2xl border border-keva-line bg-white/90 p-4 shadow-sm sm:p-5">
    <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-3"><div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#ff9a68] to-[#dd6134] font-serif text-2xl font-bold text-white sm:h-12 sm:w-12 sm:text-3xl">K</div><div><div class="font-serif text-3xl leading-none text-keva-brand sm:text-4xl">keva</div><div class="mt-0.5 text-xs font-bold tracking-[.24em] text-keva-muted sm:text-sm">HAIR CARE</div></div></div>
      <nav class="flex flex-wrap gap-2"><a class="rounded-full bg-keva-brand px-3.5 py-2 text-sm font-semibold text-white hover:bg-keva-brandDark" href="/dashboard?clinicId=${encodeURIComponent(clinicId)}">Dashboard</a><a class="rounded-full border border-keva-line px-3.5 py-2 text-sm font-semibold text-keva-muted hover:bg-keva-soft" href="/logout">Logout</a></nav>
    </div>
    <div class="mt-4 border-t border-keva-line pt-4"><p class="text-xs font-semibold uppercase tracking-[.22em] text-keva-muted">Calendar</p><h1 class="mt-1 text-xl font-bold tracking-tight sm:text-2xl">Appointments</h1><p class="mt-0.5 text-sm text-keva-muted">Clinic: ${escapeHtml(clinicId)} · ${escapeHtml(timezone)} · Cloudflare D1</p></div>
  </header>

  <section class="mt-4 rounded-2xl border border-keva-line bg-white p-4 shadow-sm">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div><p class="text-xs font-semibold uppercase tracking-[.16em] text-keva-muted">Selected date</p><h2 class="mt-0.5 text-lg font-semibold text-keva-ink sm:text-xl">${escapeHtml(date)}</h2></div>
      <div class="flex w-full items-center justify-start gap-2 overflow-x-auto lg:w-auto lg:justify-end">
        <a class="grid h-10 min-w-10 place-items-center rounded-full border border-keva-line bg-white px-3 text-sm font-semibold text-keva-brand hover:bg-keva-soft" href="/calendar?clinic=${encodeURIComponent(clinicId)}&date=${prevDate}" aria-label="Previous day">←</a>
        <span class="whitespace-nowrap rounded-full border border-keva-line bg-keva-soft px-4 py-2 text-sm font-semibold text-keva-ink">${escapeHtml(date)}</span>
        <a class="grid h-10 min-w-10 place-items-center rounded-full border border-keva-line bg-white px-3 text-sm font-semibold text-keva-brand hover:bg-keva-soft" href="/calendar?clinic=${encodeURIComponent(clinicId)}&date=${nextDate}" aria-label="Next day">→</a>
        <form class="relative h-10 min-w-10" method="get" action="/calendar">
          <input type="hidden" name="clinic" value="${escapeHtml(clinicId)}">
          <button type="button" onclick="this.nextElementSibling.showPicker ? this.nextElementSibling.showPicker() : this.nextElementSibling.click()" class="grid h-10 w-10 place-items-center rounded-full bg-transparent text-keva-brand hover:bg-keva-soft" aria-label="Pick date">
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 16h.01M12 16h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
          </button>
          <input name="date" type="date" value="${escapeHtml(date)}" onchange="this.form.submit()" class="absolute inset-0 h-10 w-10 cursor-pointer opacity-0">
        </form>
      </div>
    </div>
  </section>

  <section class="mt-6 rounded-3xl border border-keva-line bg-white shadow-sm">
    <div class="border-b border-keva-line p-5 sm:p-6"><h2 class="text-xl font-bold sm:text-2xl">Daily schedule</h2><p class="text-sm text-keva-muted">${appointments.length} appointment${appointments.length === 1 ? '' : 's'} for this date.</p></div>
    <div class="overflow-x-auto"><table class="min-w-[820px] w-full text-left text-sm text-keva-muted"><thead class="bg-keva-soft text-xs font-bold uppercase tracking-[.18em]"><tr><th class="px-4 py-3">Time</th><th class="px-4 py-3">Patient</th><th class="px-4 py-3">Phone</th><th class="px-4 py-3">Treatment</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Notes</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="px-4 py-10 text-center text-keva-muted">No appointments for this date.</td></tr>'}</tbody></table></div>
  </section>
</main></body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
