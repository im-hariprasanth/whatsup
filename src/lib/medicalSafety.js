const RISKY_PATIENT_TERMS = [
  /\bmedicine\b/i,
  /\btablet\b/i,
  /\bdosage\b/i,
  /\bdose\b/i,
  /\bprescri/i,
  /\bdiagnos/i,
  /\bside effect/i,
  /\bminoxidil\b/i,
  /\bfinasteride\b/i
];

const RISKY_REPLY_TERMS = [
  /\byou should take\b/i,
  /\btake \d+/i,
  /\bapply .* daily\b/i,
  /\bi diagnose\b/i,
  /\bguarantee\b/i,
  /\bwill definitely\b/i,
  /\bprescribe\b/i
];

const SAFE_REPLY = 'I can help guide you, but the doctor will need to assess this properly during a consultation. Would you like to book a visit with Keva?';

export function applyMedicalSafety({ userText, reply }) {
  const patientAskedRisky = RISKY_PATIENT_TERMS.some((re) => re.test(userText || ''));
  const replyLooksRisky = RISKY_REPLY_TERMS.some((re) => re.test(reply || ''));

  if (replyLooksRisky || (patientAskedRisky && /\b(take|use|apply|start|stop|mg|ml)\b/i.test(reply || ''))) {
    console.warn('[medical-safety:override]');
    return SAFE_REPLY;
  }

  return reply;
}
