# Clinic Receptionist

A multi-tenant AI receptionist for WhatsApp, built for small clinics (starting with
dermatology/skincare in India). One Cloudflare Worker serves every clinic — a "tenant"
is identified purely by which WhatsApp Business number (`phone_number_id`) received the
message. Onboarding a new clinic is a config write, never a code change or redeploy.

The first tenant, **Bonitaa Skin and Hair Care**, is used as the reference config for
local testing (see `test/fixtures/sample-tenant-config.json`), but nothing about it is
hardcoded in source — all clinic-specific content lives in `TENANTS` KV data.

## How it works

```
Clinic A/B/C WhatsApp number ──▶ Cloudflare Worker (single shared handler)
                                          │
                                          ├─▶ 1. Look up tenant config in TENANTS KV,
                                          │      keyed by phone_number_id
                                          ├─▶ 2. Read rolling history from HISTORY KV,
                                          │      keyed by `${clinicId}:${patientPhone}`
                                          ├─▶ 3. Call Groq with persona + fixed JSON contract
                                          ├─▶ 4. Send reply via Meta Graph API
                                          ├─▶ 5. Write updated history back to KV (last 8 msgs)
                                          └─▶ 6. If Groq extracted a name/treatment/appointment,
                                                 upsert it into D1, tagged with clinicId
```

Every Groq call does double duty: the model returns `{"reply": "...", "extract": null | {...}}`
in one JSON response. `reply` goes to the patient; `extract` is only non-null when the
patient shared something worth remembering long-term, and triggers a D1 upsert.

## Prerequisites

- Node.js 18+
- A Cloudflare account (free tier is enough at pilot volume)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) — installed as a
  dev dependency, run via `npx wrangler` or the npm scripts below
- A [Groq API key](https://console.groq.com/keys)
- A Meta WhatsApp Business app with at least one test number (`phone_number_id` +
  permanent/temporary access token)

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

Two secrets are shared across all tenants — `GROQ_API_KEY` (your Groq account key) and
`VERIFY_TOKEN` (a string you invent yourself, used only to authenticate the webhook
endpoint to Meta). Per-tenant secrets (`metaToken`) live inside each `TENANTS` KV value
instead, which is what makes onboarding a new clinic not require a redeploy.

**Local dev:**

```bash
cp .dev.vars.example .dev.vars
# then edit .dev.vars and fill in real values (.dev.vars is gitignored)
```

**Production:**

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put VERIFY_TOKEN
```

## 4. Local dev testing

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
`TENANTS` KV key.)

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

### Prove rolling memory works

Send the text message fixture again (same `from` number, so same history key), editing
the message body first so you can see it's genuinely a second turn, e.g.:

```bash
node -e "
const fs = require('fs');
const fixture = JSON.parse(fs.readFileSync('test/fixtures/webhook-text-message.json'));
fixture.entry[0].changes[0].value.messages[0].text.body = 'What time do you open on Saturday?';
fs.writeFileSync('second-message.json', JSON.stringify(fixture));
"
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  --data-binary @second-message.json
```

(`second-message.json` is written to the repo root as scratch output — delete it
afterward, or add it to `.gitignore` if you'll run this repeatedly.)

The second `[groq:request]` log's `messages` array should now contain the first
exchange (the original question + the assistant's reply) ahead of the new user message —
proof the `HISTORY` KV round-trip is working, not just present in code.

### Confirm the D1 upsert

The first fixture message includes a name ("I'm Priya") and a treatment interest ("hair
straightening"), so it should produce a non-null `extract` and a row in `clients`:

```bash
npx wrangler d1 execute CRM_DB --local --command="SELECT * FROM clients;"
```

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

## 5. Onboarding a new clinic

`scripts/onboard-tenant.js` turns clinic details into a valid `TENANTS` KV entry without
hand-writing JSON. By default it's a dry run that just prints the config and the exact
`wrangler kv key put` command; pass `--apply` to actually run it.

```bash
# From a JSON file
node scripts/onboard-tenant.js --file path/to/clinic.json --local

# Or inline
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

## 6. Deploy to production

```bash
npx wrangler deploy
```

Then, in the Meta App Dashboard, point the WhatsApp webhook at
`https://<your-worker>.<your-subdomain>.workers.dev/` with the same `VERIFY_TOKEN` you
set as a secret, and subscribe to the `messages` field.

## Out of scope for v1

No web dashboard (query D1 directly with `wrangler d1 execute`), no billing/auth/admin
panel, no automated Embedded Signup flow (phone_number_id + metaToken are obtained
manually per clinic and handed to the onboarding script), no RAG over treatment catalogs,
no automated test framework — the fixtures and flow above are the test suite for v1.
