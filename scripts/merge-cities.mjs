// Copies a staging city into data/cities only when it passes the research gate.
// Prints a diff, then removes that city from the inbox. A failing file stays in staging.
// Run: node scripts/merge-cities.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { loadReport, reviewFlags, validateForMerge } from '../packages/cities/validate.js';

const stagingDir = new URL('../data/staging/cities/', import.meta.url);
const liveDir = new URL('../data/cities/', import.meta.url);
mkdirSync(liveDir, { recursive: true });

const names = readdirSync(stagingDir).filter((name) => name.endsWith('.json')).sort();
if (!names.length) {
  console.log('staging inbox is empty');
  process.exit(0);
}

function clearInbox(name, slug) {
  unlinkSync(new URL(name, stagingDir));
  const report = new URL(`../data/staging/reports/${slug}.json`, import.meta.url);
  if (existsSync(report)) unlinkSync(report);
}

let failed = 0;
let merged = 0;
for (const name of names) {
  const slug = name.replace(/\.json$/, '');
  const raw = readFileSync(new URL(name, stagingDir), 'utf8');
  let city;
  try {
    city = JSON.parse(raw);
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
    console.error(`${name}: not merged, ${errors.length} errors`);
    for (const error of errors.slice(0, 8)) console.error(`  ${error}`);
    continue;
  }
  for (const flag of reviewFlags(city)) console.log(`flag: ${flag}`);
  const dest = new URL(name, liveDir);
  if (existsSync(dest) && readFileSync(dest, 'utf8') === raw) {
    console.log(`${name}: unchanged`);
    clearInbox(name, slug);
    continue;
  }
  const printed = spawnSync('diff', ['-u', `data/cities/${name}`, `data/staging/cities/${name}`], { encoding: 'utf8' });
  if (printed.stdout) process.stdout.write(printed.stdout);
  else console.log(`${name}: new validated file`);
  writeFileSync(dest, raw);
  clearInbox(name, slug);
  merged += 1;
}

console.log(`merged ${merged}, kept ${failed} in staging`);
if (failed) process.exit(1);
