import { isWithinBusinessHours, hoursForDay } from './businessHours.js';
import { checkAppointmentConflict, createAppointment } from './appointments.js';

const DEFAULT_DURATION_MINUTES = 30;

function pendingFallback({ tenant, bookingRequest, patientPhone, patientName = null, startUTC = null, endUTC = null }) {
  const { date, time, treatment } = bookingRequest;
  return {
    confirmed: false,
    replyOverride: `Thanks — I've noted your request for ${date} at ${time}. Our team will confirm your slot shortly.`,
    crmSlot: `${date} ${time} (pending confirmation)`,
    appointment: {
      clinicId: tenant.clinicId,
      patientPhone,
      patientName,
      treatment,
      date,
      time,
      startAt: startUTC?.toISOString?.() || null,
      endAt: endUTC?.toISOString?.() || null,
      status: 'pending_confirmation',
      source: 'whatsapp_ai'
    }
  };
}

function findTreatment(treatments, name) {
  if (!Array.isArray(treatments) || !name) return null;
  const lower = name.toLowerCase();
  return treatments.find((t) => t.name.toLowerCase() === lower) ?? null;
}

function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const asUTC = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(asUTC);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const inZoneAsUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  const diff = asUTC.getTime() - inZoneAsUTC;
  return new Date(asUTC.getTime() + diff);
}

function slotTimes({ tenant, request, durationMinutes }) {
  const timezone = tenant.businessHours?.timezone ?? 'UTC';
  const startUTC = zonedTimeToUtc(request.date, request.time, timezone);
  const endUTC = new Date(startUTC.getTime() + durationMinutes * 60000);
  return { startUTC, endUTC };
}

function appointmentCapacity(tenant) {
  const capacity = Number(tenant.appointmentSlotCapacity || tenant.booking?.slotCapacity || 1);
  return Number.isFinite(capacity) && capacity > 0 ? capacity : 1;
}

function inspectBusinessHours({ tenant, request, durationMinutes }) {
  const { date, time } = request;
  if (
    tenant.businessHours &&
    !isWithinBusinessHours({ date, time, durationMinutes, businessHours: tenant.businessHours })
  ) {
    const hours = hoursForDay(date, tenant.businessHours);
    return {
      available: false,
      reason: 'out-of-hours',
      reply: hours
        ? `Sorry, that time doesn't work — we're open ${hours.open}–${hours.close} that day. Could you pick another time?`
        : `Sorry, we're closed that day. Could you pick another day?`
    };
  }
  return null;
}

async function inspectSlot({ tenant, request, env }) {
  const matchedTreatment = findTreatment(tenant.treatments, request.treatment);
  const durationMinutes = matchedTreatment?.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const hoursResult = inspectBusinessHours({ tenant, request, durationMinutes });
  if (hoursResult) return { ...hoursResult, durationMinutes };

  const { startUTC, endUTC } = slotTimes({ tenant, request, durationMinutes });

  try {
    const capacity = appointmentCapacity(tenant);
    const conflict = await checkAppointmentConflict({
      clinicId: tenant.clinicId,
      startAt: startUTC.toISOString(),
      endAt: endUTC.toISOString(),
      capacity,
      env
    });
    return {
      available: !conflict,
      reason: conflict ? 'conflict' : 'free',
      conflict,
      startUTC,
      endUTC,
      durationMinutes,
      capacity
    };
  } catch (err) {
    console.error(`[booking:d1-check-failed] ${tenant.clinicId}`, err);
    return { available: null, reason: 'd1-check-failed', startUTC, endUTC, durationMinutes };
  }
}

export async function resolveAvailability({ tenant, availabilityCheck, env }) {
  const { date, time } = availabilityCheck;
  const slot = await inspectSlot({ tenant, request: availabilityCheck, env });

  if (slot.available === true) {
    console.log(`[availability:free] ${tenant.clinicId} ${date} ${time}`);
    return {
      replyOverride: `Yes, ${date} at ${time} is currently available. Would you like me to book it for your consultation?`
    };
  }

  if (slot.available === false) {
    console.log(`[availability:${slot.reason}] ${tenant.clinicId} ${date} ${time}`);
    return {
      replyOverride: slot.reply || `Sorry, that slot is already booked. Could you pick another time?`
    };
  }

  console.log(`[availability:${slot.reason}] ${tenant.clinicId} ${date} ${time}`);
  return {
    replyOverride: `I can help with that request for ${date} at ${time}. Our team will confirm the exact availability shortly.`
  };
}

export async function resolveBooking({ tenant, bookingRequest, patientPhone, patientName = null, env }) {
  const { date, time, treatment: treatmentName } = bookingRequest;
  const slot = await inspectSlot({ tenant, request: bookingRequest, env });

  if (slot.available === false) {
    console.log(`[booking:${slot.reason}] ${tenant.clinicId} ${date} ${time}`);
    return {
      confirmed: false,
      replyOverride: slot.reply || `Sorry, that slot is already booked. Could you pick another time?`,
      crmSlot: null
    };
  }

  if (slot.available === null) {
    console.log(`[booking:${slot.reason}] ${tenant.clinicId} ${date} ${time}`);
    return pendingFallback({ tenant, bookingRequest, patientPhone, patientName, startUTC: slot.startUTC, endUTC: slot.endUTC });
  }

  let appointment;
  try {
    appointment = await createAppointment({
      clinicId: tenant.clinicId,
      patientPhone,
      patientName,
      treatment: treatmentName,
      date,
      time,
      durationMinutes: slot.durationMinutes,
      startAt: slot.startUTC.toISOString(),
      endAt: slot.endUTC.toISOString(),
      status: 'confirmed',
      source: 'whatsapp_ai'
    }, env);
  } catch (err) {
    if (err.code === 'slot_conflict') {
      console.log(`[booking:conflict] ${tenant.clinicId} ${date} ${time}`);
      return {
        confirmed: false,
        replyOverride: `Sorry, that slot is already booked. Could you pick another time?`,
        crmSlot: null
      };
    }
    console.error(`[booking:d1-create-failed] ${tenant.clinicId}`, err);
    return pendingFallback({ tenant, bookingRequest, patientPhone, patientName, startUTC: slot.startUTC, endUTC: slot.endUTC });
  }

  console.log(`[booking:confirmed] ${tenant.clinicId} ${date} ${time}`);
  return {
    confirmed: true,
    replyOverride: `Confirmed — your consultation is booked for ${date} at ${time}. We look forward to seeing you.`,
    crmSlot: `${date} ${time}`,
    appointment
  };
}
