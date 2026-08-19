const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

// One Groq call handles reply/extraction plus deterministic tool intents.
// `messages` already includes the system prompt (tenant persona + fixed JSON
// contract) plus rolling history plus the new user message. Returns the parsed
// { reply, extract, bookingRequest, availabilityCheck, statusCheck }.
export async function generateReply(messages, env) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL || DEFAULT_MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.4
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error('Groq returned non-JSON content:', content);
    throw err;
  }

  return {
    reply: parsed.reply,
    extract: parsed.extract ?? null,
    bookingRequest: parsed.booking_request ?? null,
    availabilityCheck: parsed.availability_check ?? null,
    statusCheck: parsed.status_check === true
  };
}
