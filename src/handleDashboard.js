import { getLeadStats } from './lib/leads.js';
import { countAppointmentsForDate } from './lib/appointments.js';
import { requireAuth } from './lib/auth.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function todayInTimezone(timezone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function statCard(label, value, dotClass) {
  return `<section class="rounded-2xl border border-keva-line bg-white p-5 shadow-sm sm:p-6">
    <div class="flex items-center gap-2.5 text-sm font-medium text-keva-muted"><span class="h-2.5 w-2.5 rounded-full ${dotClass}"></span>${escapeHtml(label)}</div>
    <div class="mt-3 text-4xl font-semibold tracking-tight text-keva-ink">${Number(value || 0)}</div>
  </section>`;
}

export async function handleDashboard(request, env) {
  const authResponse = await requireAuth(request, env);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const clinicId = url.searchParams.get('clinicId') || url.searchParams.get('clinic') || 'bonitaa';
  const { stats, recent } = await getLeadStats(clinicId, env);
  const today = todayInTimezone('Asia/Kolkata');
  const todayAppointments = await countAppointmentsForDate({ clinicId, date: today, env });

  const rows = recent.map((lead) => `
    <tr class="border-t border-keva-line/70 hover:bg-keva-soft/40">
      <td class="whitespace-nowrap px-4 py-3 font-medium text-keva-ink">${escapeHtml(lead.name || '—')}</td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(lead.phone)}</td>
      <td class="whitespace-nowrap px-4 py-3"><span class="rounded-full bg-keva-soft px-2.5 py-1 text-xs font-semibold text-keva-muted ring-1 ring-keva-line">${escapeHtml(lead.status)}</span></td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(lead.follow_up_count)}</td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(lead.source || '—')}</td>
      <td class="whitespace-nowrap px-4 py-3">${escapeHtml(lead.created_at)}</td>
    </tr>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keva Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{keva:{page:'#fffdfb',soft:'#fbf4f0',card:'#f8eee9',line:'#eadbd4',ink:'#241816',muted:'#70645f',brand:'#c75a34',brandDark:'#9f3d1c',gold:'#c69205',green:'#08b51f',salmon:'#ee7d59',taupe:'#a58a80'}}}}}</script>
</head><body class="min-h-screen bg-keva-page text-keva-ink antialiased">
<main class="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
  <header class="rounded-3xl border border-keva-line bg-white/80 p-5 shadow-sm sm:p-6">
    <div class="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-4">
        <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#ff9a68] to-[#dd6134] font-serif text-3xl font-bold text-white shadow-sm sm:h-16 sm:w-16 sm:text-4xl">K</div>
        <div><div class="font-serif text-4xl leading-none text-keva-brand sm:text-5xl">keva</div><div class="mt-1 text-sm font-bold tracking-[.28em] text-keva-muted sm:text-base">HAIR CARE</div></div>
      </div>
      <nav class="flex flex-wrap gap-2.5">
        <a class="rounded-full bg-keva-brand px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-keva-brandDark" href="/calendar?clinic=${encodeURIComponent(clinicId)}&date=${today}">Calendar</a>
        <a class="rounded-full border border-keva-line px-4 py-2.5 text-sm font-bold text-keva-muted hover:bg-keva-soft" href="/logout">Logout</a>
      </nav>
    </div>
    <div class="mt-6 border-t border-keva-line pt-5">
      <p class="text-sm font-semibold uppercase tracking-[.24em] text-keva-muted">Dashboard</p>
      <h1 class="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Lead rescue overview</h1>
      <p class="mt-1 text-keva-muted">Today: ${escapeHtml(today)} · Clinic: ${escapeHtml(clinicId)} · Cloudflare D1</p>
    </div>
  </header>

  <section class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
    ${statCard('New today', stats?.new_today || 0, 'bg-keva-taupe')}
    ${statCard('Contacted', stats?.contacted || 0, 'bg-keva-gold')}
    ${statCard('Replied', stats?.replied || 0, 'bg-keva-green')}
    ${statCard('Exhausted', stats?.exhausted || 0, 'bg-keva-salmon')}
    ${statCard('Appointments', todayAppointments, 'bg-keva-brand')}
    ${statCard('Total leads', stats?.total_leads || 0, 'bg-keva-ink')}
  </section>

  <section class="mt-8 rounded-3xl border border-keva-line bg-white shadow-sm">
    <div class="flex flex-col gap-2 border-b border-keva-line p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
      <div><h2 class="text-xl font-bold sm:text-2xl">Recent leads</h2><p class="text-sm text-keva-muted">Latest Facebook lead/ad and WhatsApp follow-up records.</p></div>
    </div>
    <div class="overflow-x-auto"><table class="min-w-[860px] w-full text-left text-sm text-keva-muted"><thead class="bg-keva-soft text-xs font-bold uppercase tracking-[.18em]"><tr><th class="px-4 py-3">Name</th><th class="px-4 py-3">Phone</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Follow-ups</th><th class="px-4 py-3">Source</th><th class="px-4 py-3">Created</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="px-4 py-10 text-center text-keva-muted">No leads yet.</td></tr>'}</tbody></table></div>
  </section>
</main></body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
