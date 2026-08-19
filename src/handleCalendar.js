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

function hourLabel(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function dateHeader(date, timezone) {
  const day = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }).formatToParts(day);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { weekday: map.weekday?.toUpperCase() || '', day: map.day || '', title: `${map.month} ${map.day}, ${map.year}`, timezone };
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

  const visibleHours = new Set(Array.from({ length: 13 }, (_, i) => i + 8));
  for (const appt of appointments) {
    const hour = Number(String(appt.time || '').split(':')[0]);
    if (!Number.isNaN(hour)) visibleHours.add(hour);
  }
  const scheduleRows = [...visibleHours].sort((a, b) => a - b).map((hour) => {
    const hourAppointments = appointments.filter((appt) => Number(String(appt.time || '').split(':')[0]) === hour);
    const cards = hourAppointments.map((appt, index) => {
      const minutes = Number(String(appt.time || '').split(':')[1] || 0);
      const overCapacity = index >= 4;
      return `<button type="button" onclick="openAppointment(this)" style="margin-top:${Math.min(minutes, 45)}px" class="min-w-[165px] flex-1 rounded-xl border ${overCapacity ? 'border-red-200 bg-red-50' : 'border-keva-line bg-keva-soft'} px-3 py-2.5 text-left text-xs shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:min-w-[205px]"
        data-time="${escapeHtml(appointmentTime(appt.time))}"
        data-patient="${escapeHtml(appt.patient_name || '—')}"
        data-phone="${escapeHtml(appt.patient_phone)}"
        data-treatment="${escapeHtml(appt.treatment)}"
        data-status="${escapeHtml(appt.status)}"
        data-notes="${escapeHtml(appt.notes || '—')}"
        data-source="${escapeHtml(appt.source || '—')}">
        <span class="flex items-start gap-2">
          <span class="mt-0.5 h-8 w-1.5 shrink-0 rounded-full ${overCapacity ? 'bg-red-500' : 'bg-keva-brand'}"></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-bold text-keva-ink">${escapeHtml(appt.patient_name || appt.patient_phone || 'Patient')}</span>
            <span class="mt-0.5 block truncate font-medium text-keva-muted">${escapeHtml(appt.treatment || 'Appointment')}</span>
            <span class="mt-2 inline-flex rounded-full ${overCapacity ? 'bg-red-100 text-red-700' : 'bg-white text-keva-brand'} px-2 py-0.5 text-[11px] font-bold ring-1 ${overCapacity ? 'ring-red-200' : 'ring-keva-line'}">${escapeHtml(appointmentTime(appt.time))}${overCapacity ? ' · over capacity' : ''}</span>
          </span>
        </span>
      </button>`;
    }).join('');
    return `<div class="grid grid-cols-[58px_1fr] sm:grid-cols-[72px_1fr]">
      <div class="border-r border-keva-line pr-2 pt-2 text-right text-xs text-keva-muted">${escapeHtml(hourLabel(hour))}</div>
      <div class="min-h-[88px] border-b border-keva-line px-2 py-2 sm:px-3">
        <div class="flex items-start gap-2 overflow-x-auto pb-1">${cards}</div>
      </div>
    </div>`;
  }).join('');
  const headerDate = dateHeader(date, timezone);

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

  <section class="mt-5 overflow-hidden rounded-2xl border border-keva-line bg-white shadow-sm">
    <div class="grid grid-cols-[58px_1fr] border-b border-keva-line bg-white sm:grid-cols-[72px_1fr]">
      <div class="border-r border-keva-line"></div>
      <div class="flex items-end gap-4 px-4 py-3">
        <div class="text-center"><div class="text-[11px] font-semibold text-keva-muted">${escapeHtml(headerDate.weekday)}</div><div class="text-2xl font-normal leading-none text-keva-ink">${escapeHtml(headerDate.day)}</div></div>
        <div><h2 class="text-lg font-semibold sm:text-xl">${escapeHtml(headerDate.title)}</h2><p class="text-sm text-keva-muted">${appointments.length} appointment${appointments.length === 1 ? '' : 's'} · up to 4 bookings per time slot</p></div>
      </div>
    </div>
    <div class="max-h-[72vh] overflow-y-auto">
      ${scheduleRows}
    </div>
  </section>
</main>

<div id="appointment-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/35 p-4" onclick="if(event.target.id==='appointment-modal') closeAppointment()">
  <div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-keva-line">
    <div class="flex items-start justify-between gap-4"><div><p class="text-xs font-semibold uppercase tracking-[.18em] text-keva-muted">Appointment</p><h3 id="modal-treatment" class="mt-1 text-xl font-bold text-keva-ink"></h3></div><button class="rounded-full p-2 text-keva-muted hover:bg-keva-soft" onclick="closeAppointment()" aria-label="Close">✕</button></div>
    <dl class="mt-5 grid gap-3 text-sm">
      <div class="flex justify-between gap-4 border-b border-keva-line pb-2"><dt class="text-keva-muted">Time</dt><dd id="modal-time" class="font-semibold text-keva-ink"></dd></div>
      <div class="flex justify-between gap-4 border-b border-keva-line pb-2"><dt class="text-keva-muted">Patient</dt><dd id="modal-patient" class="font-semibold text-keva-ink"></dd></div>
      <div class="flex justify-between gap-4 border-b border-keva-line pb-2"><dt class="text-keva-muted">Phone</dt><dd id="modal-phone" class="font-semibold text-keva-ink"></dd></div>
      <div class="flex justify-between gap-4 border-b border-keva-line pb-2"><dt class="text-keva-muted">Status</dt><dd id="modal-status" class="font-semibold text-keva-ink"></dd></div>
      <div class="flex justify-between gap-4 border-b border-keva-line pb-2"><dt class="text-keva-muted">Source</dt><dd id="modal-source" class="font-semibold text-keva-ink"></dd></div>
      <div><dt class="text-keva-muted">Notes</dt><dd id="modal-notes" class="mt-1 rounded-xl bg-keva-soft p-3 text-keva-ink"></dd></div>
    </dl>
  </div>
</div>
<script>
function openAppointment(el){
  const modal=document.getElementById('appointment-modal');
  document.getElementById('modal-treatment').textContent=el.dataset.treatment||'Appointment';
  document.getElementById('modal-time').textContent=el.dataset.time||'—';
  document.getElementById('modal-patient').textContent=el.dataset.patient||'—';
  document.getElementById('modal-phone').textContent=el.dataset.phone||'—';
  document.getElementById('modal-status').textContent=el.dataset.status||'—';
  document.getElementById('modal-source').textContent=el.dataset.source||'—';
  document.getElementById('modal-notes').textContent=el.dataset.notes||'—';
  modal.classList.remove('hidden'); modal.classList.add('flex');
}
function closeAppointment(){
  const modal=document.getElementById('appointment-modal');
  modal.classList.add('hidden'); modal.classList.remove('flex');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAppointment()});
</script>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
