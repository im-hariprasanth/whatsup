# Keva / Clinic Receptionist

A Cloudflare Worker based WhatsApp AI receptionist and lead-rescue system for clinic pilots.

Current stack:

```txt
Cloudflare Worker  - webhook/API runtime
Cloudflare KV      - tenant config + rolling chat history
Cloudflare D1      - clients, leads, follow-ups, appointments
Meta APIs          - WhatsApp Cloud API + Lead Ads
Groq               - AI receptionist JSON response
```

No Google Calendar or Supabase is required in the current code path.

## Features

- WhatsApp inbound AI receptionist
- Facebook Lead Ads webhook intake
- WhatsApp template follow-up sequence capped at 3 messages
- Patient reply stops pending follow-ups
- D1 CRM memory for clients/leads
- D1 appointment booking with slot capacity
- Simple lead dashboard: `/dashboard`
- Simple appointment view: `/calendar`
- Guardrails for model output validation and medical safety

## Booking rules

Appointments are stored in D1 table `appointments`.

Tenant config can set:

```json
"appointmentSlotCapacity": 4
```

A slot is available while active overlapping appointments are below capacity.

Active blocking statuses:

```txt
confirmed
pending_confirmation
```

## Setup

Install dependencies:

```bash
npm install
```

Create/update Cloudflare resources and put IDs in `wrangler.toml`:

```txt
TENANTS KV
HISTORY KV
CRM_DB D1
```

Set secrets:

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put VERIFY_TOKEN
npx wrangler secret put DASHBOARD_USERNAME
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put SESSION_SECRET
# Optional model override. Default is openai/gpt-oss-20b.
npx wrangler secret put GROQ_MODEL
```

Apply D1 schema:

```bash
npm run d1:migrate:local
npm run d1:migrate:remote
```

Onboard/update tenant:

```bash
node scripts/onboard-tenant.js --file configs/keva-tenant.example.json --local --apply
# production: remove --local and use real Keva Meta values
```

Run locally:

```bash
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Tests

```bash
npm run smoke
npx wrangler deploy --dry-run
```

## Useful routes

```txt
GET  /                         Meta webhook verification
POST /                         Meta webhook receiver
GET  /login                    Dashboard login
GET  /dashboard?clinicId=keva  Lead dashboard
GET  /calendar?clinic=keva     Appointment view
GET  /tasks/followups/run      Manual follow-up processor
```
