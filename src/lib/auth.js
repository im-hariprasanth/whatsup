const COOKIE_NAME = 'keva_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return atob(padded);
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(sig));
}

function configured(env) {
  return Boolean(env.DASHBOARD_USERNAME && env.DASHBOARD_PASSWORD && env.SESSION_SECRET);
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

export async function createSessionCookie(env) {
  const payload = base64UrlEncode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
  const signature = await sign(payload, env.SESSION_SECRET);
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export async function isAuthenticated(request, env) {
  if (!configured(env)) {
    const url = new URL(request.url);
    return !env.DASHBOARD_TOKEN || url.searchParams.get('token') === env.DASHBOARD_TOKEN;
  }

  const cookie = getCookie(request, COOKIE_NAME);
  if (!cookie || !cookie.includes('.')) return false;
  const [payload, signature] = cookie.split('.');
  if ((await sign(payload, env.SESSION_SECRET)) !== signature) return false;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    return Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function requireAuth(request, env) {
  if (await isAuthenticated(request, env)) return null;
  const url = new URL(request.url);
  const next = encodeURIComponent(`${url.pathname}${url.search}`);
  return Response.redirect(`${url.origin}/login?next=${next}`, 302);
}

export async function handleLogin(request, env) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next') || '/dashboard?clinicId=bonitaa';
  let error = false;

  if (!configured(env)) {
    return new Response('Login is not configured. Set DASHBOARD_USERNAME, DASHBOARD_PASSWORD, and SESSION_SECRET.', { status: 500 });
  }

  if (request.method === 'POST') {
    const form = await request.formData();
    const username = String(form.get('username') || '');
    const password = String(form.get('password') || '');
    if (username === env.DASHBOARD_USERNAME && password === env.DASHBOARD_PASSWORD) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: new URL(next, url.origin).toString(),
          'Set-Cookie': await createSessionCookie(env)
        }
      });
    }
    error = true;
  }

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Keva Login</title>
<style>:root{color-scheme:light;--bg:#fffdfb;--ink:#231815;--muted:#746a66;--brand:#c6531b;--card:#f8eee9;--line:#eadbd4}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg)!important;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif}.wrap{min-height:100vh;display:grid;place-items:center;padding:28px}.box{width:min(460px,94vw);background:#fffaf7;border:2px solid var(--line);border-radius:34px;padding:34px;box-shadow:0 16px 36px rgba(80,42,25,.08)}.brand{display:flex;align-items:center;gap:22px;margin-bottom:30px}.logo{width:86px;height:86px;border-radius:22px;background:linear-gradient(145deg,#ff9a68,#df6235);display:grid;place-items:center;color:white;font-family:Georgia,serif;font-size:50px;font-weight:700}.keva{font-family:Georgia,serif;color:#cf6a45;font-size:48px;line-height:.9}.hair{letter-spacing:.28em;color:#675955;font-weight:800;margin-top:10px}.title{font-size:28px;margin:0 0 18px}.field{width:100%;padding:16px 18px;margin:9px 0;border-radius:16px;border:2px solid var(--line);background:white;color:var(--ink);font-size:18px}.btn{width:100%;padding:16px 18px;margin-top:14px;border:0;border-radius:999px;background:var(--brand);color:white;font-weight:900;font-size:20px}.err{background:#fff0e8;color:#b94118;border:1px solid #f3c4ad;border-radius:14px;padding:10px 12px;margin-bottom:12px}</style></head><body><main class="wrap"><form class="box" method="post"><div class="brand"><div class="logo">K</div><div><div class="keva">keva</div><div class="hair">HAIR CARE</div></div></div><h1 class="title">Dashboard Login</h1>${error ? '<div class="err">Invalid username or password.</div>' : ''}<input class="field" name="username" placeholder="Username" autocomplete="username" required><input class="field" name="password" type="password" placeholder="Password" autocomplete="current-password" required><button class="btn">Login</button></form></main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export function handleLogout(request) {
  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/login`,
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    }
  });
}
