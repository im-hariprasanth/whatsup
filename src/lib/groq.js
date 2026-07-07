const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Upgraded from llama-3.1-8b-instant — verified live that the 8B model lost
// track of its own immediately preceding message across multiple turns
// (re-proposing a fabricated slot instead of confirming the one it had just
// offered, then losing the thread of the conversation entirely). The
// deterministic guards elsewhere (pendingSlot, the name gate, never trusting
// the model on facts) stay exactly as-is regardless of which model drafts
// replies — this only changes reply quality/coherence, same API and key.
const MODEL = 'llama-3.3-70b-versatile';

// One Groq call does quadruple duty: `messages` already includes the system
// prompt (tenant persona + fixed JSON contract) plus rolling history plus the
// new user message. Returns the parsed { reply, extract, proposedSlot,
// confirmBooking, statusCheck } — never a second call in the common path.
export async function generateReply(messages, env) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
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
    proposedSlot: parsed.proposed_slot ?? null,
    confirmBooking: parsed.confirm_booking === true,
    statusCheck: parsed.status_check === true
  };
}
