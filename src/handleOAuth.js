import { getTenant, putTenant } from './lib/tenant.js';
import { buildAuthUrl, exchangeCodeForTokens } from './lib/googleAuth.js';

// Kicks off a clinic's one-time Google Calendar authorization. `tenant` is
// the phone_number_id (already visible in webhook metadata, so not itself
// secret) -- the `token` query param, checked against OAUTH_SETUP_TOKEN, is
// what actually gates this so a stranger can't hijack a clinic's calendar
// binding with their own Google account.
export async function handleOAuthStart(request, env) {
  const url = new URL(request.url);
  const phoneNumberId = url.searchParams.get('tenant');
  const calendarId = url.searchParams.get('calendarId') || 'primary';
  const token = url.searchParams.get('token');

  if (!phoneNumberId || !token) {
    return new Response('Missing tenant or token', { status: 400 });
  }
  if (token !== env.OAUTH_SETUP_TOKEN) {
    return new Response('Forbidden', { status: 403 });
  }

  const tenant = await getTenant(phoneNumberId, env);
  if (!tenant) {
    return new Response(`No tenant found for phone_number_id=${phoneNumberId}`, { status: 404 });
  }

  const redirectUri = `${url.origin}/oauth/google/callback`;
  const authUrl = buildAuthUrl({ phoneNumberId, calendarId, redirectUri, env });

  return Response.redirect(authUrl, 302);
}

// Completes the handshake: exchanges the auth code for tokens and writes
// the resulting refresh token into the tenant's existing KV entry via
// read-modify-write. Access tokens are never stored -- refreshAccessToken
// mints a fresh one from the refresh token on every booking attempt instead.
export async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(
      `Google authorization was not completed (${error}). You can close this tab and try again.`,
      { status: 200 }
    );
  }

  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  if (!code || !stateRaw) {
    return new Response('Missing code or state', { status: 400 });
  }

  // url.searchParams.get() already URL-decodes the value once — do not
  // decode it again here, or a state value containing "%" sequences (there
  // aren't any today, but there's no reason to double-decode regardless)
  // would be corrupted.
  let phoneNumberId, calendarId;
  try {
    ({ phoneNumberId, calendarId } = JSON.parse(stateRaw));
  } catch (err) {
    return new Response('Invalid state parameter', { status: 400 });
  }

  const redirectUri = `${url.origin}/oauth/google/callback`;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code, redirectUri, env });
  } catch (err) {
    console.error('[oauth:exchange-failed]', err);
    return new Response('Failed to complete Google authorization. Please try again.', { status: 500 });
  }

  // Edge case even with prompt=consent -- fail loudly rather than silently
  // storing a tenant config that can never actually book anything.
  if (!tokens.refreshToken) {
    return new Response(
      "Google didn't return a refresh token (this can happen if access was already granted before). " +
        'Please revoke access at https://myaccount.google.com/permissions and try connecting again.',
      { status: 200 }
    );
  }

  const tenant = await getTenant(phoneNumberId, env);
  if (!tenant) {
    return new Response(`No tenant found for phone_number_id=${phoneNumberId}`, { status: 404 });
  }

  await putTenant(
    phoneNumberId,
    { ...tenant, googleCalendar: { calendarId, refreshToken: tokens.refreshToken } },
    env
  );

  console.log(`[oauth:connected] ${tenant.clinicId} calendarId=${calendarId}`);

  return new Response(`Google Calendar connected for ${tenant.clinicName}. You can close this tab.`, {
    status: 200
  });
}
