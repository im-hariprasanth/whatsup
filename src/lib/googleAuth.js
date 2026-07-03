const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

// One shared Google Cloud OAuth app issues a separate refresh token per
// clinic. state carries which tenant + which calendar this authorization is
// for, so the callback knows where to write the resulting refresh token.
export function buildAuthUrl({ phoneNumberId, calendarId, redirectUri, env }) {
  // Raw JSON, not pre-encoded — URLSearchParams.toString() percent-encodes
  // every value itself, so encoding it here too would double-encode it.
  const state = JSON.stringify({ phoneNumberId, calendarId });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    // Required to reliably get a refresh_token back, even for a clinic
    // that's authorized before (e.g. reconnecting after revoking access).
    prompt: 'consent',
    state
  });

  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens({ code, redirectUri, env }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in
  };
}

export async function refreshAccessToken({ refreshToken, env }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    // invalid_grant here almost always means the refresh token died -- most
    // commonly the OAuth consent screen was left in "Testing" status, which
    // silently expires tokens after 7 days. Distinct log line so this is at
    // least discoverable via `wrangler tail` (there's no dashboard).
    if (errText.includes('invalid_grant')) {
      console.error(`[booking:refresh-failed] invalid_grant — refresh token likely expired`);
    }
    throw new Error(`Google token refresh failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}
