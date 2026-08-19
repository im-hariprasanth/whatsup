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

function appointmentPayload(appt) {
  return {
    id: appt.id,
    time: appt.time,
    displayTime: appointmentTime(appt.time),
    patientName: appt.patient_name || '—',
    patientPhone: appt.patient_phone || '',
    treatment: appt.treatment || 'Appointment',
    status: appt.status || '',
    source: appt.source || '—',
    notes: appt.notes || '—'
  };
}

export async function handleAppointmentsApi(request, env) {
  const authResponse = await requireAuth(request, env);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const clinicId = url.searchParams.get('clinic') || url.searchParams.get('clinicId') || 'bonitaa';
  const tenant = await getTenantByClinicId(clinicId, env);
  if (!tenant) return new Response(JSON.stringify({ error: 'tenant_not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const timezone = tenant.businessHours?.timezone || 'Asia/Kolkata';
  const date = url.searchParams.get('date') || formatLocalDate(new Date(), timezone);
  const appointments = await listAppointments({ clinicId, date, env });
  return new Response(JSON.stringify({ clinicId, date, timezone, generatedAt: new Date().toISOString(), appointments: appointments.map(appointmentPayload) }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
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
    const visibleCards = hourAppointments.slice(0, 4).map((appt) => `
      <button type="button" onclick="openAppointment(this)" class="rounded-full border border-keva-line bg-keva-soft px-3 py-1.5 text-left text-xs font-semibold text-keva-ink shadow-sm transition hover:border-keva-brand hover:bg-white"
        data-time="${escapeHtml(appointmentTime(appt.time))}"
        data-patient="${escapeHtml(appt.patient_name || '—')}"
        data-phone="${escapeHtml(appt.patient_phone)}"
        data-treatment="${escapeHtml(appt.treatment)}"
        data-status="${escapeHtml(appt.status)}"
        data-notes="${escapeHtml(appt.notes || '—')}"
        data-source="${escapeHtml(appt.source || '—')}">
        <span class="inline-block h-2 w-2 rounded-full bg-keva-brand"></span>
        <span class="ml-1.5">${escapeHtml(appt.patient_name || appt.patient_phone || 'Patient')}</span>
      </button>`).join('');
    const more = hourAppointments.length > 4 ? `<button type="button" onclick="openSlot(${hour})" class="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100">+${hourAppointments.length - 4} more</button>` : '';
    const count = hourAppointments.length ? `<span class="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-keva-muted ring-1 ring-keva-line">${hourAppointments.length}/4 booked</span>` : '';
    return `<div class="grid grid-cols-[58px_1fr] sm:grid-cols-[72px_1fr]">
      <div class="border-r border-keva-line pr-2 pt-3 text-right text-xs text-keva-muted">${escapeHtml(hourLabel(hour))}</div>
      <div class="min-h-[72px] border-b border-keva-line px-3 py-3">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 flex-wrap items-center gap-2">${visibleCards}${more}</div>
          ${count}
        </div>
      </div>
    </div>`;
  }).join('');
  const headerDate = dateHeader(date, timezone);
  const initialAppointments = JSON.stringify(appointments.map(appointmentPayload)).replace(/</g, '\\u003c');

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
        <div><h2 class="text-lg font-semibold sm:text-xl">${escapeHtml(headerDate.title)}</h2><p class="text-sm text-keva-muted"><span id="appointment-count">${appointments.length} appointment${appointments.length === 1 ? '' : 's'}</span> · up to 4 bookings per time slot · <span id="live-status">Live</span></p></div>
      </div>
    </div>
    <div id="schedule-body" class="max-h-[72vh] overflow-y-auto">
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

<div id="slot-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/35 p-4" onclick="if(event.target.id==='slot-modal') closeSlot()">
  <div class="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-keva-line">
    <div class="flex items-start justify-between gap-4"><div><p class="text-xs font-semibold uppercase tracking-[.18em] text-keva-muted">Slot bookings</p><h3 id="slot-title" class="mt-1 text-xl font-bold text-keva-ink"></h3></div><button class="rounded-full p-2 text-keva-muted hover:bg-keva-soft" onclick="closeSlot()" aria-label="Close">✕</button></div>
    <div id="slot-list" class="mt-5 grid gap-2"></div>
  </div>
</div>
<script>
const clinicId=${JSON.stringify(clinicId)};
const selectedDate=${JSON.stringify(date)};
const initialAppointments=${initialAppointments};
let currentAppointments=initialAppointments;
const visibleHours=Array.from({length:13},(_,i)=>i+8);
function esc(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function hourLabel(hour){if(hour===0)return'12 AM';if(hour<12)return hour+' AM';if(hour===12)return'12 PM';return(hour-12)+' PM';}
function apptAttrs(a){return ' data-time="'+esc(a.displayTime)+'" data-patient="'+esc(a.patientName)+'" data-phone="'+esc(a.patientPhone)+'" data-treatment="'+esc(a.treatment)+'" data-status="'+esc(a.status)+'" data-notes="'+esc(a.notes)+'" data-source="'+esc(a.source)+'"';}
function renderSchedule(appointments){
  currentAppointments=appointments;
  const hours=new Set(visibleHours); appointments.forEach(a=>{const h=Number(String(a.time||'').split(':')[0]); if(!Number.isNaN(h)) hours.add(h);});
  document.getElementById('appointment-count').textContent=appointments.length+' appointment'+(appointments.length===1?'':'s');
  document.getElementById('schedule-body').innerHTML=[...hours].sort((a,b)=>a-b).map(hour=>{
    const slot=appointments.filter(a=>Number(String(a.time||'').split(':')[0])===hour);
    const chips=slot.slice(0,4).map(a=>'<button type="button" onclick="openAppointment(this)" class="max-w-full rounded-full border border-keva-line bg-keva-soft px-3 py-1.5 text-xs font-semibold text-keva-ink shadow-sm transition hover:border-keva-brand hover:bg-white"'+apptAttrs(a)+'><span class="inline-block h-2 w-2 rounded-full bg-keva-brand"></span><span class="ml-1.5">'+esc(a.patientName||a.patientPhone||'Patient')+'</span></button>').join('');
    const more=slot.length>4?'<button type="button" onclick="openSlot('+hour+')" class="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100">+'+(slot.length-4)+' more</button>':'';
    const count=slot.length?'<span class="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold '+(slot.length>4?'text-red-700 ring-red-200':'text-keva-muted ring-keva-line')+' ring-1">'+slot.length+'/4 booked</span>':'';
    return '<div class="grid grid-cols-[58px_1fr] sm:grid-cols-[72px_1fr]"><div class="border-r border-keva-line pr-2 pt-3 text-right text-xs text-keva-muted">'+esc(hourLabel(hour))+'</div><div class="min-h-[72px] border-b border-keva-line px-3 py-3"><div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div class="flex min-w-0 flex-wrap items-center gap-2">'+chips+more+'</div>'+count+'</div></div></div>';
  }).join('');
}
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
function closeAppointment(){const modal=document.getElementById('appointment-modal');modal.classList.add('hidden');modal.classList.remove('flex');}
function openSlot(hour){
  const slot=currentAppointments.filter(a=>Number(String(a.time||'').split(':')[0])===hour);
  document.getElementById('slot-title').textContent=hourLabel(hour)+' · '+slot.length+'/4 booked';
  document.getElementById('slot-list').innerHTML=slot.map((a,index)=>'<button type="button" onclick="closeSlot(); openAppointment(this)" class="flex items-center justify-between gap-3 rounded-xl border '+(index>=4?'border-red-200 bg-red-50':'border-keva-line bg-keva-soft')+' p-3 text-left hover:bg-white"'+apptAttrs(a)+'><span class="min-w-0"><span class="block truncate text-sm font-bold text-keva-ink">'+esc(a.patientName||a.patientPhone||'Patient')+'</span><span class="block truncate text-xs text-keva-muted">'+esc(a.treatment)+' · '+esc(a.displayTime)+'</span></span><span class="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-bold '+(index>=4?'text-red-700':'text-keva-brand')+' ring-1 ring-keva-line">'+(index>=4?'Over cap':'View')+'</span></button>').join('');
  const modal=document.getElementById('slot-modal'); modal.classList.remove('hidden'); modal.classList.add('flex');
}
function closeSlot(){const modal=document.getElementById('slot-modal');modal.classList.add('hidden');modal.classList.remove('flex');}
async function refreshAppointments(){
  try{
    const res=await fetch('/api/appointments?clinic='+encodeURIComponent(clinicId)+'&date='+encodeURIComponent(selectedDate),{cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json(); renderSchedule(data.appointments||[]);
    document.getElementById('live-status').textContent='Live · updated '+new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  }catch(err){document.getElementById('live-status').textContent='Live update paused'; console.warn(err);}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAppointment();closeSlot();}});
renderSchedule(initialAppointments);
setInterval(refreshAppointments,10000);
</script>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
