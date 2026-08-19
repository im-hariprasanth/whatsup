# Cloudflare D1 Appointment Storage Update

We decided to keep appointments inside Cloudflare instead of Supabase.

## Current decision

Cloudflare D1 is now used for appointment storage, availability checks, booking conflicts, appointment status lookup, and `/calendar` display.

Supabase is not required for the current private Keva setup.

## Why

- Cloudflare already provides D1 SQL database.
- The Worker can query D1 directly without external service keys.
- Simpler deployment for Keva-only private setup.
- No Google Calendar dependency.
- No Supabase dependency unless we choose to add it later for a richer CRM.

## Appointment table

Defined in:

```txt
schema/d1-schema.sql
```

Table:

```txt
appointments
```

Key fields:

```txt
clinic_id
patient_phone
patient_name
treatment
date
time
duration_minutes
start_at
end_at
status
source
notes
```

## Booking flow

```txt
Patient asks to book
→ AI extracts date/time/treatment
→ business hours check
→ D1 overlap conflict check
→ if free, insert appointment row in D1
→ send confirmation
```

## Capacity and conflict detection

Keva can handle multiple patients in the same slot. Configure capacity in tenant config:

```json
"appointmentSlotCapacity": 4
```

With this setting, a 2:00–2:30 slot can hold 4 active appointments. The 5th overlapping booking is rejected.

The system counts overlapping appointment windows:

```sql
start_at < requested_end
AND end_at > requested_start
AND status IN ('confirmed', 'pending_confirmation')
```

A slot is available while:

```txt
overlapping active appointments < appointmentSlotCapacity
```

## Calendar view

```txt
/calendar?clinic=keva&date=YYYY-MM-DD
```

Now reads from D1 `appointments`.

## Status check

When patient asks:

```txt
What time is my appointment?
```

The system checks latest active D1 appointment first, then falls back to `clients.appointment_slot`.

## Remaining CRM decision

D1 currently stores:

```txt
clients
leads
lead_followups
appointments
```

This is enough for Keva pilot/private setup.

A richer CRM can still be built on top of D1 first. Supabase is optional later if we need advanced admin/database tooling.
