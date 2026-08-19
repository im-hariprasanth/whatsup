#!/usr/bin/env node
'use strict';

async function main() {
  const { validateModelOutput } = await import('../src/lib/validateModelOutput.js');
  const { applyMedicalSafety } = await import('../src/lib/medicalSafety.js');

  const tenant = {
    clinicId: 'keva',
    treatments: [{ name: 'PRP consultation' }, { name: 'Hair fall consultation' }]
  };

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  let out = validateModelOutput({
    reply: 'ok',
    bookingRequest: { date: '2026-08-17', time: '14:00', treatment: 'Unknown treatment' },
    availabilityCheck: { date: 'bad-date', time: '14:00', treatment: 'PRP consultation' },
    statusCheck: 'yes'
  }, tenant);

  assert(out.bookingRequest === null, 'Invalid treatment should remove booking request');
  assert(out.availabilityCheck === null, 'Invalid date should remove availability check');
  assert(out.statusCheck === false, 'Non-boolean status check should be false');
  console.log('PASS model output validation rejects invalid actions');

  out = validateModelOutput({
    reply: 'ok',
    bookingRequest: { date: '2026-08-17', time: '14:00', treatment: 'PRP consultation' },
    statusCheck: true
  }, tenant);
  assert(out.bookingRequest?.treatment === 'PRP consultation', 'Valid booking should survive');
  assert(out.statusCheck === true, 'Boolean status_check should survive');
  console.log('PASS model output validation accepts valid actions');

  const safe = applyMedicalSafety({
    userText: 'What medicine should I take for hair fall?',
    reply: 'You should take 5mg daily.'
  });
  assert(/doctor will need to assess/i.test(safe), 'Unsafe medical reply should be overridden');
  console.log('PASS medical safety overrides unsafe reply');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
