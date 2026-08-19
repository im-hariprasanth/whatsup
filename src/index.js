import { handleMessage } from './handleMessage.js';
import { handleLeadAds, processDueFollowUps } from './handleLeadAds.js';
import { handleDashboard } from './handleDashboard.js';
import { handleCalendar, handleAppointmentsApi } from './handleCalendar.js';
import { handleLogin, handleLogout, requireAuth } from './lib/auth.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Narrow, path-specific routes checked first; everything else falls
    // through to the method-only Meta webhook handling at "/" below
    // (unchanged -- still what's registered in Meta's dashboard).
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/login') {
      return handleLogin(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/logout') {
      return handleLogout(request);
    }
    if (request.method === 'GET' && url.pathname === '/dashboard') {
      return handleDashboard(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/calendar') {
      return handleCalendar(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/appointments') {
      return handleAppointmentsApi(request, env);
    }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/tasks/followups/run') {
      const authResponse = await requireAuth(request, env);
      if (authResponse) return authResponse;
      ctx.waitUntil(processDueFollowUps(env));
      return new Response('Queued', { status: 202 });
    }

    if (request.method === 'GET') {
      // Meta webhook verification handshake.
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      if (!mode && url.pathname === '/') {
        return Response.redirect(`${url.origin}/dashboard?clinicId=bonitaa`, 302);
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'POST') {
      const payload = await request.json();

      // Ack immediately — Meta expects a fast 200. The actual Groq call,
      // WhatsApp send, and KV/D1 writes happen after the response is sent.
      ctx.waitUntil(
        (async () => {
          const handledLeadAd = await handleLeadAds(payload, env);
          if (!handledLeadAd) await handleMessage(payload, env);
        })().catch((err) => {
          console.error('webhook handling failed:', err);
        })
      );

      return new Response('OK', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processDueFollowUps(env));
  }
};
