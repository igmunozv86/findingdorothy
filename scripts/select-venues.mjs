// Validator for worker output in data/staging/cities.
// A failing file is not ready to merge. Review flags are printed and do not fail this check.
// Run: node scripts/select-venues.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { reviewFlags, validateCity } from '../packages/cities/validate.js';

const directory = new URL('../data/staging/cities/', import.meta.url);
let names = [];
try {
  names = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
} catch {
  console.error('No staging directory at data/staging/cities');
  process.exit(1);
}
if (!names.length) {
  console.error('No staging city files');
  process.exit(1);
}

let failed = 0;
for (const name of names) {
  let city;
  try {
    city = JSON.parse(readFileSync(new URL(name, directory)));
  } catch (err) {
    failed += 1;
    console.error(`${name}: ${err.message}`);
    continue;
  }
  const errors = validateCity(city, name);
  if (errors.length) {
    failed += 1;
    console.error(`${name}: ${errors.length} errors`);
    for (const error of errors.slice(0, 8)) console.error(`  ${error}`);
    if (errors.length > 8) console.error(`  … and ${errors.length - 8} more`);
    continue;
  }
  const flags = reviewFlags(city);
  console.log(`${name}: ok${flags.length ? `, ${flags.length} review flags` : ''}`);
  for (const flag of flags) console.log(`  flag: ${flag}`);
}

if (failed) {
  console.error(`${failed} staging files failed validation and must not merge`);
  process.exit(1);
}
console.log(`ok ${names.length} staging files`);
