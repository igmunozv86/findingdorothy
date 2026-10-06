// Copies a staging city into data/cities only when it passes validation.
// Prints a diff for every file it writes. A failing file stays in staging.
// Run: node scripts/merge-cities.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { reviewFlags, validateCity } from '../packages/cities/validate.js';

const stagingDir = new URL('../data/staging/cities/', import.meta.url);
const liveDir = new URL('../data/cities/', import.meta.url);
mkdirSync(liveDir, { recursive: true });

const names = readdirSync(stagingDir).filter((name) => name.endsWith('.json')).sort();
if (!names.length) {
  console.error('No staging city files');
  process.exit(1);
}

let failed = 0;
let merged = 0;
for (const name of names) {
  const raw = readFileSync(new URL(name, stagingDir), 'utf8');
  let city;
  try {
    city = JSON.parse(raw);
  } catch (err) {
    failed += 1;
    console.error(`${name}: ${err.message}`);
    continue;
  }
  const errors = validateCity(city, name);
  if (errors.length) {
    failed += 1;
    console.error(`${name}: not merged, ${errors.length} errors`);
    continue;
  }
  const dest = new URL(name, liveDir);
  if (existsSync(dest) && readFileSync(dest, 'utf8') === raw) {
    console.log(`${name}: unchanged`);
    continue;
  }
  const printed = spawnSync('diff', ['-u', `data/cities/${name}`, `data/staging/cities/${name}`], { encoding: 'utf8' });
  if (printed.stdout) process.stdout.write(printed.stdout);
  else console.log(`${name}: new validated file`);
  for (const flag of reviewFlags(city)) console.log(`flag: ${flag}`);
  writeFileSync(dest, raw);
  merged += 1;
}

console.log(`merged ${merged}, kept ${failed} in staging`);
if (failed) process.exit(1);
