# Customizing the Receptionist for a New Clinic

This is the practical companion to the main `README.md` (which covers infrastructure
setup — Cloudflare, secrets, deploy). This doc is about the other half: once the
platform is running, how do you configure it so a **specific** clinic gets accurate,
specific answers instead of generic ones?

## What we've built, in one paragraph

One Cloudflare Worker serves every clinic. A WhatsApp message arrives, the Worker looks
up which clinic owns the receiving number, builds a system prompt from that clinic's
config, and asks Groq (`llama-3.1-8b-instant`) for a reply. The same call also extracts
anything worth remembering (name, treatment interest, appointment details) into a D1
database, and — if the clinic has connected a calendar — resolves real appointment
bookings against actual Google Calendar availability, enforcing the clinic's real
business hours along the way. **Everything clinic-specific lives in one JSON config
per clinic. Onboarding a new clinic never touches code or requires a redeploy.**

## The five things that make responses *specific* instead of generic

These are the fields that actually get read out loud to the model on every message.
Fill these in carefully — they're the difference between "we offer various treatments"
and "hair straightening starts at ₹800 and takes about an hour."

### 1. `personaPrompt` — identity and tone

Free text. This is where you tell the model *who* it is — clinic name, city, general
vibe. Keep it short; it's read on every single message alongside everything else below,
and this model (8B parameters) gets less reliable the longer and more cluttered its
instructions get.

```
"You are the receptionist at Bonitaa Skin and Hair Care clinic in Coimbatore. Answer
patient questions about treatments, pricing, and appointments warmly and briefly."
```

Don't put pricing, hours, or specialty scope here — those belong in the structured
fields below, where the code guarantees they're accurate and consistently enforced
instead of hoping the model remembers prose correctly.

### 2. `specialty` — what the clinic actually treats (and honestly declines outside it)

```json
"specialty": ["Dermatology", "Hair Care"]
```

An array of strings. This is read into the prompt with an explicit instruction: *only
discuss topics within this specialty, and say so honestly if a patient asks about
something outside it, rather than guessing.* Verified live — asking Bonitaa's number
about root canals got "No, we specialize in dermatology and hair care... I'd recommend a
nearby clinic" instead of a hallucinated answer, while an in-specialty question still got
an accurate, specific reply.

Optional — a tenant without it just doesn't get that explicit boundary enforced (the
model still infers scope loosely from `personaPrompt`, less reliably).

### 3. `treatments` — what they offer and what it costs

An array. Each entry:

```json
{
  "name": "Hair straightening",
  "price": "₹800 onwards",
  "durationMinutes": 60,
  "description": "Smoothing treatment for frizz-free hair"
}
```

- `name` and `price` are required; `durationMinutes` and `description` are optional but
  matter more than they look —
- `durationMinutes` directly controls how long a real Calendar slot gets blocked when
  someone books this treatment. Skip it and booking falls back to a generic 30-minute
  block, which will be wrong for anything longer.
- `name` must be something the model can match against what a patient says (it does a
  case-insensitive match). If a patient asks about "hair straightening" and your
  treatment is named "Hair Straightening Treatment," it'll still match fine — but wildly
  different phrasing might not, so keep names close to how a patient would actually say them.

### 4. `businessHours` — real slot/time enforcement, not just prompt text

```json
{
  "timezone": "Asia/Kolkata",
  "days": {
    "monday": null,
    "tuesday": { "open": "10:00", "close": "19:00" },
    "wednesday": { "open": "10:00", "close": "19:00" },
    "thursday": { "open": "10:00", "close": "19:00" },
    "friday": { "open": "10:00", "close": "19:00" },
    "saturday": { "open": "10:00", "close": "19:00" },
    "sunday": { "open": "10:00", "close": "19:00" }
  }
}
```

`null` means closed that day. This field does double duty:

- It's shown to the model, so it naturally avoids suggesting closed times.
- **It's also checked in code, independent of the model** (`src/lib/businessHours.js`).
  Even if the model tries to confirm an appointment outside these hours, the deterministic
  check catches it and sends a correction instead — the model's word is never final on
  this.

`timezone` must be a valid IANA name (e.g. `Asia/Kolkata`, `Asia/Dubai`) — it's what lets
the system correctly resolve "tomorrow" or "this Saturday" into a real date, and what
makes real Calendar bookings land at the correct local time instead of shifted by hours.

### 5. `salesStyle` — optional tone nudge

One short sentence, e.g. `"Warm and concise, never pushy"` or `"Professional and
efficient, minimal small talk"`. Layered on top of a fixed shared sales-flow instruction
every clinic gets (greet → understand need → recommend → handle hesitation → confirm).
Skip it if the default warm/friendly tone is fine as-is.

## Step-by-step: onboarding a new clinic

1. **Get WhatsApp Business credentials.** From the clinic's Meta Business/WhatsApp Cloud
   API setup: a `phone_number_id` and an access token (`metaToken`). This part is manual
   — there's no automated signup flow (see README's "Out of scope").

2. **Write the five fields above** into a JSON file. See the full example below.

3. **Dry-run it:**
   ```bash
   node scripts/onboard-tenant.js --file new-clinic.json
   ```
   This prints exactly what will be written without touching anything — check the
   treatments/hours rendered correctly before going further.

4. **Apply it for real:**
   ```bash
   node scripts/onboard-tenant.js --file new-clinic.json --apply
   ```
   The clinic is live immediately. No redeploy.

5. **(Optional) Connect Google Calendar** for real appointment booking — send the clinic
   this link (see README step 4 for the one-time platform setup this depends on):
   ```
   https://<your-worker>.workers.dev/oauth/google/start?tenant=<phone_number_id>&token=<OAUTH_SETUP_TOKEN>
   ```
   Without this, booking requests still work conversationally — the patient just gets an
   honest "we'll confirm shortly" instead of a real-time calendar confirmation.

6. **Test it.** Send the clinic's WhatsApp number a real message, or replay a fixture
   locally against this tenant's `phone_number_id`. Ask about a specific treatment's
   price and a specific day's hours — if the answer is accurate and specific, the config
   is working.

7. **Re-running onboarding later is safe.** The script merges onto the existing config
   rather than overwriting it — updating just the price list won't wipe a connected
   calendar.

## Full worked example

A second, different clinic — a dental clinic — to show the pattern isn't
dermatology-specific:

```json
{
  "phoneNumberId": "1122334455667788",
  "clinicId": "smilecare",
  "clinicName": "SmileCare Dental Clinic",
  "metaToken": "EAA...",
  "personaPrompt": "You are the receptionist at SmileCare Dental Clinic in Bangalore. Answer patient questions about treatments, pricing, and appointments warmly and briefly.",
  "salesStyle": "Professional and reassuring — many patients are anxious about dental visits",
  "specialty": ["General Dentistry", "Cosmetic Dentistry"],
  "treatments": [
    { "name": "Teeth cleaning", "price": "₹1500", "durationMinutes": 30, "description": "Routine scaling and polishing" },
    { "name": "Root canal treatment", "price": "₹4000 onwards", "durationMinutes": 90, "description": "Single sitting root canal with modern equipment" },
    { "name": "Teeth whitening", "price": "₹6000", "durationMinutes": 60, "description": "In-clinic professional whitening" }
  ],
  "businessHours": {
    "timezone": "Asia/Kolkata",
    "days": {
      "monday": { "open": "09:00", "close": "18:00" },
      "tuesday": { "open": "09:00", "close": "18:00" },
      "wednesday": { "open": "09:00", "close": "18:00" },
      "thursday": { "open": "09:00", "close": "18:00" },
      "friday": { "open": "09:00", "close": "18:00" },
      "saturday": { "open": "09:00", "close": "14:00" },
      "sunday": null
    }
  }
}
```

Same code, same Worker, completely different clinic identity, treatments, hours, and
tone — that's the whole point of the tenant model.

## Where to check what the AI has captured

- **CRM data** (name, treatment interest, appointment slot, notes): `wrangler d1 execute
  CRM_DB --remote --command="SELECT * FROM clients WHERE clinic_id='<clinicId>';"`, or
  the Cloudflare Dashboard's D1 console (Workers & Pages → D1 → the database → Console
  tab).
- **Real bookings**: the clinic's connected Google Calendar directly — events are titled
  `<treatment> — WhatsApp booking`.

## Suggestions — things worth considering adding

`specialty` (below) is now implemented. Remaining gaps, in rough priority order:

1. **Holiday/exception dates.** `businessHours` currently only supports a fixed weekly
   pattern — there's no way to mark "closed this Diwali" or "half-day on this specific
   date" without editing the whole weekly schedule and back. Worth adding if clinics
   regularly have one-off closures (most do).

2. **Doctor/staff assignment per treatment.** If a clinic has multiple
   doctors/specialists and patients care which one they see, that's not captured
   anywhere right now — bookings go onto one shared calendar with no staff distinction.

3. **Cancellation/rescheduling via chat.** The system can create a booking, but there's
   no path for a patient to say "actually, can we move it to Thursday" and have that
   update or cancel the existing calendar event — today that would just create a second,
   separate booking request.

4. **A minimum booking notice window.** Nothing currently stops a patient from
   "confirming" an appointment 10 minutes from now that staff have no realistic way to
   prepare for.

5. **Multi-location clinics.** The model is one config = one WhatsApp number = one
   calendar. A clinic chain with multiple branches under one WhatsApp number isn't
   supported — you'd onboard each branch as its own "clinic" with its own number today.

None of these are required to onboard your next clinic — the five fields above are
enough for accurate, specific responses today. These are just the next layer if the
product needs to handle more complex clinic operations.
