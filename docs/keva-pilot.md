# Keva Pilot Setup

This project remains one shared demo/production worker. Keva is added as a tenant; do not create a fake Meta identity.

## Keva tenant config

Use `configs/keva-tenant.example.json` as the starting point and replace these real Meta values from Keva:

- `phoneNumberId`: WhatsApp Cloud API phone_number_id for Keva's WhatsApp number/WABA
- `metaToken`: token with WhatsApp message send permission
- `leadAds.pageId`: Keva Facebook Page id
- `leadAds.formId`: Keva Lead Form id (optional; omit only if all forms on the page should route to Keva)
- `leadAds.pageAccessToken`: page token with permission to fetch lead details
- template names in `leadFollowUps.templates`: approved WhatsApp templates in Keva's WABA

Dry run:

```bash
node scripts/onboard-tenant.js --file configs/keva-tenant.example.json --local
```

Apply locally:

```bash
node scripts/onboard-tenant.js --file configs/keva-tenant.example.json --local --apply
```

Apply remotely after replacing real values:

```bash
node scripts/onboard-tenant.js --file configs/keva-tenant.json --apply
```

## Flow

Facebook Lead Ad webhook -> fetches lead details from Meta -> saves `leads` row -> sends template #1 immediately -> schedules template #2 at +24h and template #3 at +72h. Cron (`*/15 * * * *`) sends due follow-ups. If the patient replies on WhatsApp, pending follow-ups are cancelled and the existing AI receptionist flow continues.

Dashboard:

```txt
/dashboard?clinicId=keva
/dashboard?clinicId=keva&token=<DASHBOARD_TOKEN>   # if secret is set
```

Manual follow-up runner for local acceptance testing (cron runs this in production):

```txt
/tasks/followups/run
/tasks/followups/run?token=<DASHBOARD_TOKEN>        # if secret is set
```
