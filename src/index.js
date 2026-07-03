import { handleMessage } from './handleMessage.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      // Meta webhook verification handshake.
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'POST') {
      const payload = await request.json();

      // Ack immediately — Meta expects a fast 200. The actual Groq call,
      // WhatsApp send, and KV/D1 writes happen after the response is sent.
      ctx.waitUntil(
        handleMessage(payload, env).catch((err) => {
          console.error('handleMessage failed:', err);
        })
      );

      return new Response('OK', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  }
};
