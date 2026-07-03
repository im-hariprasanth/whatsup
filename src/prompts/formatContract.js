// Fixed JSON output contract, appended to every tenant's persona prompt.
// Tenant config supplies business content only; this shape never varies per tenant.
export const JSON_FORMAT_INSTRUCTIONS = `Respond ONLY with a JSON object in this exact shape, no other text:
{"reply": "<single short paragraph, no line breaks or bullet points>",
"extract": null or {"name": string|null, "treatment_interest": string|null,
"appointment_slot": string|null, "notes": string|null}}

Set "extract" to null unless the patient just shared their name, expressed clear interest
in a specific treatment, mentioned/confirmed a preferred appointment date or time, or
shared something else genuinely worth remembering for their file. Never invent
information the patient didn't say. Only include fields that are new or changed in THIS
message. Never mention AI, bots, or automation.`;
