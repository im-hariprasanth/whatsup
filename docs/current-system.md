# Current System

This is the current source of truth for the codebase.

## Runtime

```txt
Cloudflare Worker
Cloudflare KV
Cloudflare D1
Meta WhatsApp + Lead Ads
Groq AI
```

No Google Calendar. No Supabase.

## Data stores

### KV

```txt
TENANTS - tenant config keyed by WhatsApp phone_number_id
HISTORY - rolling conversation history and lightweight state
```

### D1

```txt
clients          - CRM memory
leads            - lead ad records
lead_followups   - scheduled follow-up queue
appointments     - booking source of truth
```

## Main flows

### WhatsApp AI receptionist

```txt
Webhook message
→ tenant lookup
→ dedupe
→ load history
→ Groq JSON
→ validate model output
→ deterministic booking/availability/status logic
→ medical safety override
→ send WhatsApp reply
→ save history/CRM
```

### Lead rescue

```txt
Lead Ads webhook
→ fetch lead details
→ save D1 lead
→ send template #1
→ schedule #2 at +24h and #3 at +72h
→ patient reply marks replied and cancels pending follow-ups
```

### Booking

```txt
booking_request
→ business hours check
→ D1 overlapping appointment count
→ compare with appointmentSlotCapacity
→ insert appointment if below capacity
→ deterministic confirmation
```

Keva default:

```json
"appointmentSlotCapacity": 4
```

## Guardrails

```txt
validateModelOutput.js - validates AI JSON/actions
medicalSafety.js       - overrides unsafe medical replies
booking.js             - code decides availability/booking truth
appointments.js        - D1 appointment capacity/conflict logic
```

## Routes

```txt
/dashboard?clinicId=keva
/calendar?clinic=keva&date=YYYY-MM-DD
/tasks/followups/run
```
