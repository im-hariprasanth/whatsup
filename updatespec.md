# Update Spec: Simple Guardrailed Keva AI Receptionist

## Goal

Keep the system simple and efficient while making the AI receptionist safer and more reliable for Keva.

Stack:

```txt
Cloudflare Worker
Cloudflare KV
Cloudflare D1
Meta WhatsApp / Lead Ads
Groq AI
```

No Google Calendar. No Supabase for now.

## Part 1 — D1 appointment capacity

Appointments are stored in Cloudflare D1.

Keva can handle 4 appointments in the same time block:

```json
"appointmentSlotCapacity": 4
```

A booking is blocked only when overlapping active appointments are already at capacity.

Active statuses:

```txt
confirmed
pending_confirmation
```

## Part 2 — Model output validation

Add a small validation layer after Groq response.

Validate:

```txt
reply is string
booking_request date/time/treatment are valid
availability_check date/time/treatment are valid
status_check is boolean
treatment matches tenant treatments when configured
```

Invalid booking/availability actions are ignored safely.

## Part 3 — Medical safety guardrail

Before sending a reply, check for unsafe medical behavior.

Block/override replies involving:

```txt
diagnosis
prescription
medicine dosage
guaranteed result
doctor-like decision
```

Safe fallback:

```txt
I can help guide you, but the doctor will need to assess this properly during a consultation. Would you like to book a visit with Keva?
```

## Part 4 — Lightweight conversation state

Use KV to store tiny state per patient:

```txt
state:<clinicId>:<patientPhone>
```

Store:

```json
{
  "stage": "availability_checked",
  "lastOfferedSlot": { "date": "...", "time": "...", "treatment": "..." },
  "updatedAt": "..."
}
```

Keep it simple. No complex state machine yet.

## Part 5 — Dashboard counts

Update dashboard with:

```txt
total leads
contacted
replied
exhausted
today appointments
recent leads
```

Keep UI basic.

## Part 6 — Smoke tests

Maintain simple smoke tests for:

```txt
booking under capacity
booking full capacity
out of hours
validation invalid treatment
medical safety override
```

## Part 7 — D1 migration

Run:

```bash
npm run d1:migrate:local
npm run d1:migrate:remote
```

## Part 8 — Deploy

Deploy with:

```bash
npx wrangler deploy
```

Only after tests pass.

## Part 9 — Live acceptance test

Test:

```txt
lead capture
WhatsApp reply
booking under capacity
5th booking blocked
status check
/calendar view
/dashboard view
```
