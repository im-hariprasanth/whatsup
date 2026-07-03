# Clinic Receptionist

A multi-tenant AI receptionist for WhatsApp, built for small clinics (starting with
dermatology/skincare in India). One Cloudflare Worker serves every clinic — a "tenant"
is identified purely by which WhatsApp Business number (`phone_number_id`) received the
message. Onboarding a new clinic is a config write, never a code change or redeploy.

The first tenant, **Bonitaa Skin and Hair Care**, is used as the reference config for
local testing (see `test/fixtures/sample-tenant-config.json`), but nothing about it is
hardcoded in source — all clinic-specific content lives in `TENANTS` KV data.

This README covers infrastructure setup. For configuring a *specific* clinic's
treatments, hours, and tone once the platform is running, see
[`docs/customizing-a-clinic.md`](docs/customizing-a-clinic.md).

## How it works

```
Clinic A/B/C WhatsApp number ──▶ Cloudflare Worker (single shared handler)
                                          │
                                          ├─▶ 1. Dedupe on message id (idempotency)
                                          ├─▶ 2. Look up tenant config in TENANTS KV,
                                          │      keyed by phone_number_id
                                          ├─▶ 3. Read rolling history from HISTORY KV,
                                          │      keyed by `${clinicId}:${patientPhone}`
                                          ├─▶ 4. Call Groq with persona + sales-flow
                                          │      guidance + structured treatments/hours
                                          │      + fixed JSON contract
                                          ├─▶ 5. If a booking was requested, resolve it
                                          │      deterministically (hours check → Google
                                          │      Calendar freebusy/insert if connected)
                                          ├─▶ 6. Send reply via Meta Graph API
                                          ├─▶ 7. Write updated history back to KV (last 8 msgs)
                                          └─▶ 8. Upsert name/treatment/appointment into D1
```

Every Groq call does triple duty: the model returns
`{"reply": "...", "extract": null | {...}, "booking_request": null | {...}}` in one JSON
response. `reply` goes to the patient (unless a booking outcome overrides it — see below);
`extract` triggers a D1 upsert when non-null; `booking_request` triggers deterministic
(non-AI) resolution against business hours and, if the clinic has connected a calendar,
real Google Calendar availability. This still never adds a second AI call in the common
path — booking resolution is plain code, not another Groq round trip.

**A booking request never becomes a false confirmation.** If the clinic hasn't connected
a calendar, or the requested time is outside business hours, or a Calendar API call fails,
the patient gets an honest "we'll confirm shortly" message instead of the AI's optimistic
"you're booked!" — and that's also what gets stored in history and the CRM, so the
conversation never desyncs from what the patient actually saw.

## Prerequisites

- Node.js 18+
- A Cloudflare account (free tier is enough at pilot volume)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) — installed as a
  dev dependency, run via `npx wrangler` or the npm scripts below
- A [Groq API key](https://console.groq.com/keys)
- A Meta WhatsApp Business app with at least one test number (`phone_number_id` +
  permanent/temporary access token)
- *(Optional, for real appointment booking)* A Google Cloud project with the Calendar API
  enabled and an OAuth client — see step 4 below

```bash
npm install
```

## 1. Create the KV namespaces

```bash
npx wrangler kv namespace create TENANTS
npx wrangler kv namespace create HISTORY
```

Each command prints an `id`. Copy both into `wrangler.toml`, replacing
`REPLACE_WITH_TENANTS_NAMESPACE_ID` and `REPLACE_WITH_HISTORY_NAMESPACE_ID`.

## 2. Create the D1 database and apply the schema

```bash
npx wrangler d1 create clinic-receptionist-crm
```

Copy the printed `database_id` into `wrangler.toml`, replacing
`REPLACE_WITH_D1_DATABASE_ID`. Then apply the schema:

```bash
# Local (used by `wrangler dev`)
npm run d1:migrate:local

# Remote (production database)
npm run d1:migrate:remote
```

Both just run `wrangler d1 execute CRM_DB --file=./schema/d1-schema.sql` against the
local or remote database.

## 3. Set secrets

Shared across all tenants: `GROQ_API_KEY` (your Groq account key), `VERIFY_TOKEN` (a
string you invent, authenticates the webhook endpoint to Meta), and — if you want real
Calendar booking — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OAUTH_SETUP_TOKEN`
(see step 4). Per-tenant secrets (`metaToken`, and each clinic's Calendar refresh token)
live inside each `TENANTS` KV value instead, which is what makes onboarding a new clinic
not require a redeploy.

**Local dev:**

```bash
cp .dev.vars.example .dev.vars
# then edit .dev.vars and fill in real values (.dev.vars is gitignored)
```

**Production:**

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put VERIFY_TOKEN
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OAUTH_SETUP_TOKEN
```

## 4. Google Calendar setup (optional — skip if you don't need real booking yet)

Without this, `booking_request`s degrade gracefully to a "we'll confirm shortly" reply —
nothing breaks, the clinic just doesn't get real calendar sync until connected.

**One-time, per deployment (not per clinic):**

1. [console.cloud.google.com](https://console.cloud.google.com) → create/select a project
2. **APIs & Services → Library** → enable the **Google Calendar API**
3. **APIs & Services → OAuth consent screen** → set up as **External**. While in
   **Testing** status, only Google accounts you explicitly add under **Test users** can
   complete authorization — add every clinic's connecting account there.
   ⚠️ **Testing status silently expires refresh tokens after 7 days.** For anything past
   initial testing, move the consent screen to **In production** (still shows an
   "unverified app" warning during consent unless you complete Google's review, but tokens
   stop expiring on the 7-day clock). A dead refresh token surfaces as
   `[booking:refresh-failed]` in `wrangler tail` with no other warning — there's no
   dashboard, so that log line is the only signal.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → **Web
   application** → add authorized redirect URI:
   `https://<your-worker>.<your-subdomain>.workers.dev/oauth/google/callback`
5. Copy the **Client ID** and **Client Secret** → set as secrets (step 3 above)
6. Generate a random `OAUTH_SETUP_TOKEN` (e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
   and set it as a secret too — this gates the connection link below so a stranger can't
   hijack a clinic's calendar with their own Google account (`phone_number_id` alone isn't
   secret, it's visible in webhook metadata).

**Per clinic, after onboarding (step 6 below):** send the clinic operator this link
(ideally to sign in with a dedicated reception/booking Google account, not a personal one):

```
https://<your-worker>.<your-subdomain>.workers.dev/oauth/google/start?tenant=<phone_number_id>&token=<OAUTH_SETUP_TOKEN>
```

They'll see Google's consent screen (with an "unverified app" warning to click through, if
not yet reviewed), grant calendar access, and land on a plain "Google Calendar connected
for `<clinic name>`" confirmation page. That's it — the resulting refresh token is written
straight into that tenant's existing `TENANTS` KV entry, no other setup needed.

## 5. Local dev testing

Start the dev server:

```bash
npm run dev
```

### Load a tenant into local KV

```bash
npx wrangler kv key put --binding=TENANTS "111222333444555" \
  --path test/fixtures/sample-tenant-config.json --local
```

(`111222333444555` is the `phone_number_id` used in the test fixtures below — it's the
`TENANTS` KV key. The fixture includes `treatments` and `businessHours` but no
`googleCalendar`, so it exercises the "not connected yet" booking fallback by default.)

### Verify the webhook GET handshake

```bash
curl "http://localhost:8787/?hub.mode=subscribe&hub.verify_token=<value from your .dev.vars>&hub.challenge=12345"
# → should return: 12345
```

### Send a text message fixture

```bash
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  --data-binary @test/fixtures/webhook-text-message.json
```

Expect an immediate `OK` response, and in the `wrangler dev` terminal:
- a `[groq:request]` log with the full messages array sent to Groq
- a `[groq:response]` log with the parsed `reply` and `extract`
- a `[whatsapp:sent]` log (or a caught `[whatsapp:error]` — expected locally, since the
  fixture's `metaToken` is a placeholder and Meta will reject it; history/CRM writes
  still happen regardless)

### Confirm non-text/status payloads are ignored

```bash
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  --data-binary @test/fixtures/webhook-delivery-receipt.json
```

Expect an `OK` response with **no** `[groq:request]` log — the handler returns early.

### Confirm duplicate webhook deliveries are deduped

POST the same fixture twice in a row (same `message.id`). Expect a
`[idempotency:duplicate] <id>` log and no second `[groq:request]` for the retry — Meta
retries webhook delivery on slow acks, and this stops a retry from double-processing.

### Prove rolling memory works

Send the text message fixture again (same `from` number, so same history key), editing
the message body first so you can see it's genuinely a second turn, e.g.:

```bash
node -e "
const fs = require('fs');
const fixture = JSON.parse(fs.readFileSync('test/fixtures/webhook-text-message.json'));
fixture.entry[0].changes[0].value.messages[0].text.body = 'What time do you open on Saturday?';
fixture.entry[0].changes[0].value.messages[0].id = 'wamid.SECONDMESSAGE' + Date.now();
fs.writeFileSync('second-message.json', JSON.stringify(fixture));
"
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  --data-binary @second-message.json
```

(`second-message.json` is written to the repo root as scratch output — delete it
afterward, or add it to `.gitignore` if you'll run this repeatedly. Note the message id is
regenerated each time — reusing the same fixture id will just be caught by idempotency.)

The second `[groq:request]` log's `messages` array should now contain the first
exchange (the original question + the assistant's reply) ahead of the new user message —
proof the `HISTORY` KV round-trip is working, not just present in code.

### Confirm the D1 upsert

The first fixture message includes a name ("I'm Priya") and a treatment interest ("hair
straightening"), so it should produce a non-null `extract` and a row in `clients`:

```bash
npx wrangler d1 execute CRM_DB --local --command="SELECT * FROM clients;"
```

### Try a booking request

Send a message that explicitly confirms a date, time, and treatment (the model is most
reliable when the confirmation message itself restates all three, rather than relying on
relative phrasing across turns) — e.g. `"Confirmed: hair straightening on 2026-07-08 at
17:00 please"`. With no `googleCalendar` connected on the local fixture, expect a
`[booking:not-connected]` log and a "we'll noted your request... team will confirm
shortly" reply (not a false confirmation) — and check `appointment_slot` in D1 reflects
the precise requested slot with a `(pending confirmation)` marker, not just the model's
free-text guess.

To test a message outside business hours (the fixture is Tue–Sun 10:00–19:00, closed
Monday), expect the model to often self-correct in the reply text already (since business
hours are in its prompt context) — but the deterministic `[booking:out-of-hours]` check in
`src/lib/booking.js` is the real backstop regardless of what the model says.

### Prove tenant isolation

Add a second tenant with a different `phone_number_id` and a different `personaPrompt`:

```bash
npx wrangler kv key put --binding=TENANTS "999888777666555" \
  --path path/to/second-clinic.json --local
```

Copy `test/fixtures/webhook-text-message.json`, change
`entry[0].changes[0].value.metadata.phone_number_id` to `999888777666555`, and POST it.
The reply should reflect the second clinic's persona, not the first — same Worker, same
code, different tenant.

## 6. Onboarding a new clinic

`scripts/onboard-tenant.js` turns clinic details into a valid `TENANTS` KV entry without
hand-writing JSON. By default it's a dry run that just prints the merged config and the
exact `wrangler kv key put` command; pass `--apply` to actually run it. It's safe to
re-run against an already-onboarded clinic (e.g. to update pricing) — it merges onto the
existing KV value rather than overwriting it, so a connected `googleCalendar` (see step 4)
is never wiped by a routine update.

```bash
# From a JSON file (needed for treatments/businessHours — too unwieldy as CLI flags)
node scripts/onboard-tenant.js --file path/to/clinic.json --local

# Or inline, for the simple fields
node scripts/onboard-tenant.js \
  --phoneNumberId 111222333444555 \
  --clinicId bonitaa \
  --clinicName "Bonitaa Skin and Hair Care" \
  --metaToken EAAxxxxxxxxxxxxxxxxxxxxxxxx \
  --personaPrompt "You are the receptionist at Bonitaa Skin and Hair Care..." \
  --apply --local
```

Drop `--local` (and add nothing else) to target the deployed remote namespace once
you're onboarding a real clinic in production.

**Full tenant config shape** (only `phoneNumberId`, `clinicId`, `clinicName`, `metaToken`,
`personaPrompt` are required — everything else is optional and additive; a tenant missing
`treatments`/`businessHours`/`salesStyle` behaves exactly as a v1-only tenant would):

```json
{
  "phoneNumberId": "the TENANTS KV key, not part of the stored value",
  "clinicId": "bonitaa",
  "clinicName": "Bonitaa Skin and Hair Care",
  "metaToken": "EAA...",
  "personaPrompt": "free text identity/tone",
  "salesStyle": "optional short free text, e.g. 'warm, concise, never pushy'",
  "treatments": [
    { "name": "Hair straightening", "price": "Rs.800 onwards", "durationMinutes": 60, "description": "..." }
  ],
  "businessHours": {
    "timezone": "Asia/Kolkata",
    "days": { "monday": null, "tuesday": { "open": "10:00", "close": "19:00" } }
  }
}
```

Never include `googleCalendar` in onboarding input — it's written exclusively by the
OAuth callback (step 4) and the script will warn and strip it if present.

## 7. Deploy to production

```bash
npx wrangler deploy
```

Then, in the Meta App Dashboard, point the WhatsApp webhook at
`https://<your-worker>.<your-subdomain>.workers.dev/` with the same `VERIFY_TOKEN` you
set as a secret, and subscribe to the `messages` field.

## Out of scope for v1

No web dashboard (query D1 directly with `wrangler d1 execute`; the two OAuth routes are
narrow redirect infrastructure, not a UI), no billing/auth/admin panel, no automated
Embedded Signup flow (phone_number_id + metaToken are obtained manually per clinic and
handed to the onboarding script), no RAG over treatment catalogs, no automated test
framework — the fixtures and flow above are the test suite for v1.

Known accepted risks, not eliminated (fine at pilot volume, worth revisiting if this
scales up): a small eventual-consistency race window on the idempotency KV check; a
similar TOCTOU race between the Calendar freebusy check and event creation for two
near-simultaneous booking requests on the same slot; a repeat `booking_request` on an
already-confirmed slot could produce a confusing false-conflict reply (no "last confirmed"
short-circuit yet).
