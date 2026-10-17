#!/usr/bin/env node
/** Read-only comparison of Coolify's stored gateway configuration.
 * Inputs are local ephemeral JSON files from an authorized API runner.
 * Do not print tokens, values, object contents or hashes.
 */
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function key(values) {
  if (!Array.isArray(values)) return null;
  const entries = values.filter((item) =>
    item && item.key === 'TASO_GATEWAY_SECRET' && item.is_preview !== true,
  );
  if (entries.length !== 1) return null;
  const value = entries[0].real_value ?? entries[0].value;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function evaluate(core, ui) {
  const a = key(core);
  const b = key(ui);
  if (!a || !b) return 'UNVERIFIABLE';
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y) ? 'MATCH' : 'MISMATCH';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4) throw new Error('files missing');
    const core = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const ui = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    console.log('coolify_production_gateway_config=' + evaluate(core, ui));
  } catch {
    console.log('coolify_production_gateway_config=UNVERIFIABLE');
    process.exitCode = 3;
  }
}
