const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function validTreatment(treatment, tenant) {
  if (!treatment || typeof treatment !== 'string') return false;
  if (!Array.isArray(tenant.treatments) || tenant.treatments.length === 0) return true;
  return tenant.treatments.some((t) => t.name === treatment);
}

function validAction(action, tenant) {
  if (!action || typeof action !== 'object') return null;
  if (!DATE_RE.test(action.date || '')) return null;
  if (!TIME_RE.test(action.time || '')) return null;
  if (!validTreatment(action.treatment, tenant)) return null;
  return {
    date: action.date,
    time: action.time,
    treatment: action.treatment
  };
}

function validExtract(extract) {
  if (!extract || typeof extract !== 'object') return null;
  return {
    ...(typeof extract.name === 'string' ? { name: extract.name } : {}),
    ...(typeof extract.treatment_interest === 'string' ? { treatment_interest: extract.treatment_interest } : {}),
    ...(typeof extract.appointment_slot === 'string' ? { appointment_slot: extract.appointment_slot } : {}),
    ...(typeof extract.notes === 'string' ? { notes: extract.notes } : {})
  };
}

export function validateModelOutput(output, tenant) {
  const safe = {
    reply: typeof output.reply === 'string' && output.reply.trim()
      ? output.reply.trim()
      : 'Thanks for reaching out. How can I help you today?',
    extract: validExtract(output.extract),
    bookingRequest: validAction(output.bookingRequest, tenant),
    availabilityCheck: validAction(output.availabilityCheck, tenant),
    statusCheck: output.statusCheck === true
  };

  if (output.bookingRequest && !safe.bookingRequest) {
    console.warn(`[model:invalid-booking-request] ${tenant.clinicId}`, JSON.stringify(output.bookingRequest));
  }
  if (output.availabilityCheck && !safe.availabilityCheck) {
    console.warn(`[model:invalid-availability-check] ${tenant.clinicId}`, JSON.stringify(output.availabilityCheck));
  }

  return safe;
}
