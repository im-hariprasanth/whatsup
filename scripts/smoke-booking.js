#!/usr/bin/env node
'use strict';

// Smoke test for the Cloudflare D1 appointment safety path:
//   node scripts/smoke-booking.js

async function main() {
  const { resolveAvailability, resolveBooking } = await import('../src/lib/booking.js');

  const tenantBase = {
    clinicId: 'keva',
    appointmentSlotCapacity: 4,
    businessHours: {
      timezone: 'Asia/Kolkata',
      days: {
        monday: { open: '10:00', close: '19:30' },
        tuesday: { open: '10:00', close: '19:30' },
        wednesday: { open: '10:00', close: '19:30' },
        thursday: { open: '10:00', close: '19:30' },
        friday: { open: '10:00', close: '19:30' },
        saturday: { open: '10:00', close: '19:30' },
        sunday: { open: '10:00', close: '19:30' }
      }
    },
    treatments: [{ name: 'PRP consultation', durationMinutes: 30 }]
  };

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function mockEnv({ overlapCount = 0, failInsert = false } = {}) {
    const calls = [];
    return {
      calls,
      CRM_DB: {
        prepare(sql) {
          return {
            bind(...args) {
              calls.push({ sql, args });
              return {
                async first() {
                  if (sql.includes('COUNT(*) AS count')) return { count: overlapCount };
                  return null;
                },
                async run() {
                  if (failInsert) throw new Error('insert failed');
                  return { meta: { last_row_id: 2 } };
                },
                async all() { return { results: [] }; }
              };
            }
          };
        }
      }
    };
  }

  const req = { date: '2026-08-17', time: '17:00', treatment: 'PRP consultation' };

  // 1 availability is free when capacity is not full (3 existing of 4)
  let env = mockEnv({ overlapCount: 3 });
  let res = await resolveAvailability({ tenant: tenantBase, availabilityCheck: req, env });
  assert(/currently available/i.test(res.replyOverride), 'Slot should be available when 3/4 are booked');
  assert(!env.calls.some((c) => c.sql.includes('INSERT INTO appointments')), 'Availability check should not create appointment');
  console.log('PASS availability is free under capacity');

  // 2 booking creates D1 appointment when capacity is not full (3 existing of 4)
  env = mockEnv({ overlapCount: 3 });
  res = await resolveBooking({ tenant: tenantBase, bookingRequest: req, patientPhone: '919876543210', env });
  assert(res.confirmed === true, 'Booking should confirm when 3/4 are booked');
  assert(/Confirmed/i.test(res.replyOverride), 'Free booking should return deterministic confirmation');
  assert(env.calls.some((c) => c.sql.includes('INSERT INTO appointments')), 'Booking should create D1 appointment');
  console.log('PASS booking under capacity creates D1 appointment');

  // 3 full capacity rejects and does not insert (4 existing of 4)
  env = mockEnv({ overlapCount: 4 });
  res = await resolveBooking({ tenant: tenantBase, bookingRequest: req, patientPhone: '919876543210', env });
  assert(res.confirmed === false, 'Full slot should not be confirmed');
  assert(/already booked/i.test(res.replyOverride), 'Full slot should tell user slot is booked');
  assert(!env.calls.some((c) => c.sql.includes('INSERT INTO appointments')), 'Full slot should not create appointment');
  console.log('PASS full capacity is rejected');

  // 4 out-of-hours rejected before D1
  env = mockEnv({ overlapCount: 0 });
  res = await resolveBooking({ tenant: tenantBase, bookingRequest: { ...req, time: '20:00' }, patientPhone: '919876543210', env });
  assert(res.confirmed === false, 'Out-of-hours booking should fail');
  assert(/open 10:00–19:30|pick another time/i.test(res.replyOverride), 'Out-of-hours reply should mention hours/change time');
  assert(env.calls.length === 0, 'Out-of-hours should not call D1');
  console.log('PASS out-of-hours rejected');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
