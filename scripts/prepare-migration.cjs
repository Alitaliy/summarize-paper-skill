// Offline only. No Supabase connection, credentials, or upload side effects.
const fs = require('node:fs');
const migration = require('../docs/migration.js');
const [input, output] = process.argv.slice(2);
try {
  if (!input) throw new Error('Usage: node scripts/prepare-migration.cjs <library-or-migration.json> [new-output.json]');
  const payload = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  const bundle = payload.format === 'summarize-paper-migration' ? payload : migration.build(payload);
  const counts = migration.validate(bundle);
  if (output) fs.writeFileSync(output, JSON.stringify(bundle), { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ mode: 'offline-validation', valid: true, counts, bytes: Buffer.byteLength(JSON.stringify(bundle)), written: Boolean(output) }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
