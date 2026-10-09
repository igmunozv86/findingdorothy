// Validator for worker output in data/staging/cities.
// Schema, the 5-venue floor, and the research report all fail this check.
// Review flags are printed and do not fail it. An empty inbox is idle, not an error.
// Run: node scripts/select-venues.mjs
// One file: node scripts/select-venues.mjs tokyo.json

import { readdirSync, readFileSync } from 'node:fs';
import { loadReport, reviewFlags, validateForMerge } from '../packages/cities/validate.js';

const directory = new URL('../data/staging/cities/', import.meta.url);
const only = process.argv[2] ? process.argv[2].replace(/\.json$/, '') : '';
let names = [];
try {
  names = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
} catch {
  console.error('No staging directory at data/staging/cities');
  process.exit(1);
}
if (only) names = names.filter((name) => name === `${only}.json`);
if (!names.length) {
  if (only) {
    console.error(`No staging file data/staging/cities/${only}.json`);
    process.exit(1);
  }
  console.log('staging inbox is empty');
  process.exit(0);
}

let failed = 0;
for (const name of names) {
  const slug = name.replace(/\.json$/, '');
  let city;
  try {
    city = JSON.parse(readFileSync(new URL(name, directory)));
  } catch (err) {
    failed += 1;
    console.error(`${name}: ${err.message}`);
    continue;
  }
  let report = null;
  try {
    report = loadReport(slug);
  } catch (err) {
    failed += 1;
    console.error(`${name}: report ${err.message}`);
    continue;
  }
  const errors = validateForMerge(city, name, report);
  if (errors.length) {
    failed += 1;
    console.error(`${name}: ${errors.length} errors`);
    for (const error of errors.slice(0, 12)) console.error(`  ${error}`);
    if (errors.length > 12) console.error(`  … and ${errors.length - 12} more`);
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
