# Customizing a Clinic

Clinic-specific behavior lives in the `TENANTS` KV namespace. The KV key is the clinic WhatsApp `phone_number_id`; the value is JSON config.

## Required fields

```json
{
  "clinicId": "keva",
  "clinicName": "Keva Hair Care Clinic",
  "metaToken": "EAA...",
  "personaPrompt": "You are the warm receptionist..."
}
```

## Recommended fields

```json
{
  "salesStyle": "Warm, reassuring, non-clinical, concise",
  "specialty": ["Hair care", "Hair transplant", "PRP", "Hair fall treatment"],
  "appointmentSlotCapacity": 4,
  "businessHours": {
    "timezone": "Asia/Kolkata",
    "days": {
      "monday": { "open": "10:00", "close": "19:30" },
      "tuesday": { "open": "10:00", "close": "19:30" }
    }
  },
  "treatments": [
    { "name": "PRP consultation", "durationMinutes": 30, "description": "Doctor consultation for PRP suitability." }
  ]
}
```

## Lead Ads config

```json
{
  "leadAds": {
    "enabled": true,
    "pageId": "FACEBOOK_PAGE_ID",
    "formId": "LEAD_FORM_ID",
    "pageAccessToken": "PAGE_ACCESS_TOKEN"
  },
  "leadFollowUps": {
    "templates": [
      { "name": "keva_lead_greeting_1", "language": "en" },
      { "name": "keva_services_reminder_2", "language": "en" },
      { "name": "keva_location_final_nudge_3", "language": "en" }
    ]
  }
}
```

## Appointment capacity

```json
"appointmentSlotCapacity": 4
```

A slot is available while overlapping active appointments are below this number.

Active blocking statuses:

```txt
confirmed
pending_confirmation
```

## Onboard/update

Dry run:

```bash
node scripts/onboard-tenant.js --file configs/keva-tenant.example.json --local
```

Apply locally:

```bash
node scripts/onboard-tenant.js --file configs/keva-tenant.example.json --local --apply
```

Apply production:

```bash
node scripts/onboard-tenant.js --file configs/keva-tenant.json --apply
```

Do not include Google Calendar or Supabase settings. The current system stores appointments in Cloudflare D1.
