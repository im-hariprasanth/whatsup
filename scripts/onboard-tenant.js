#!/usr/bin/env node
'use strict';

// Onboards a new clinic by writing (or printing the command to write) a
// TENANTS KV entry. Adding a clinic should never require a code change or
// redeploy — this script is the entire onboarding flow.
//
// Usage:
//   node scripts/onboard-tenant.js --file clinic.json [--apply] [--local]
//   node scripts/onboard-tenant.js --phoneNumberId <id> --clinicId <id> \
//     --clinicName "<name>" --metaToken <token> --personaPrompt "<prompt>" \
//     [--apply] [--local]
//
// --file      Path to a JSON file: { phoneNumberId, clinicId, clinicName, metaToken, personaPrompt }
// --apply     Actually run the generated `wrangler kv key put` command (default: dry run, just print it)
// --local     Write to the local dev KV store (`--local`) instead of the deployed namespace (`--remote`)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const REQUIRED_FIELDS = ['phoneNumberId', 'clinicId', 'clinicName', 'metaToken', 'personaPrompt'];

function usage() {
  return `
Usage:
  node scripts/onboard-tenant.js --file clinic.json [--apply] [--local]
  node scripts/onboard-tenant.js --phoneNumberId <id> --clinicId <id> --clinicName "<name>" \\
    --metaToken <token> --personaPrompt "<prompt>" [--apply] [--local]

Options:
  --file        Path to a JSON file with: ${REQUIRED_FIELDS.join(', ')}
  --apply       Actually run the wrangler command (default: print it only, dry run)
  --local       Target the local dev KV store instead of the deployed remote namespace
`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function loadConfig(args) {
  if (args.file) {
    const filePath = path.resolve(process.cwd(), args.file);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  const missing = REQUIRED_FIELDS.filter((key) => !args[key]);
  if (missing.length) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error(usage());
    process.exit(1);
  }

  return {
    phoneNumberId: args.phoneNumberId,
    clinicId: args.clinicId,
    clinicName: args.clinicName,
    metaToken: args.metaToken,
    personaPrompt: args.personaPrompt
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const config = loadConfig(args);
  const missing = REQUIRED_FIELDS.filter((key) => !config[key]);
  if (missing.length) {
    console.error(`Config is missing required fields: ${missing.join(', ')}`);
    console.error(usage());
    process.exit(1);
  }

  if (config.treatments !== undefined) {
    if (!Array.isArray(config.treatments)) {
      console.error('`treatments` must be an array.');
      process.exit(1);
    }
    config.treatments.forEach((t, i) => {
      if (!t.name || !t.price) {
        console.error(`treatments[${i}] needs at least "name" and "price".`);
        process.exit(1);
      }
      if (!t.durationMinutes) {
        console.warn(`treatments[${i}] ("${t.name}") has no durationMinutes — booking will fall back to a default duration.`);
      }
    });
  }

  const { phoneNumberId, ...tenantValue } = config;

  // Written to a temp file and passed via --path rather than inlined on the
  // command line, so quoting/escaping the JSON never breaks across shells.
  const tmpFile = path.join(
    os.tmpdir(),
    `tenant-${phoneNumberId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  );
  fs.writeFileSync(tmpFile, JSON.stringify(tenantValue), 'utf8');

  // wrangler's kv commands are remote by default; --local opts into the
  // local dev store. There's no explicit --remote flag on this CLI version.
  const scopeFlag = args.local ? '--local' : '';
  const command = `npx wrangler kv key put --binding=TENANTS "${phoneNumberId}" --path "${tmpFile}" ${scopeFlag}`.trim();

  console.log('\nTenant config (TENANTS KV value):\n');
  console.log(JSON.stringify(tenantValue, null, 2));
  console.log(`\nKV key: ${phoneNumberId}`);
  console.log('\nWrangler command:\n');
  console.log(`  ${command}\n`);

  if (args.apply) {
    console.log('Running...\n');
    execSync(command, { stdio: 'inherit', shell: true });
    console.log('\nDone. Clinic is live — no redeploy needed.');
  } else {
    console.log('(Dry run — pass --apply to actually run this command.)');
  }
}

main();
