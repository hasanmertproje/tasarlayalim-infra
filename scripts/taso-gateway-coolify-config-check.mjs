#!/usr/bin/env node
/** Read-only comparison of Coolify's stored production gateway configuration.
 * Never print secret values, hashes, lengths, request bodies, or env objects.
 */
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Coolify may return a display placeholder instead of a usable secret.
// Equal placeholders MUST NOT be treated as matching gateway credentials.
const maskedPlaceholder = /^(?:\*{3,}|•{3,}|masked|redacted|<hidden>|\[hidden\])$/i;

function inspect(values) {
  if (!Array.isArray(values)) return { state: 'INVALID_RESPONSE' };
  const entries = values.filter((item) =>
    item && item.key === 'TASO_GATEWAY_SECRET' && item.is_preview !== true,
  );
  if (entries.length === 0) return { state: 'MISSING' };
  if (entries.length !== 1) return { state: 'DUPLICATED' };
  const value = entries[0].real_value ?? entries[0].value;
  if (typeof value !== 'string' || !value.trim()) return { state: 'EMPTY_OR_UNAVAILABLE' };
  if (maskedPlaceholder.test(value.trim())) return { state: 'MASKED_OR_UNAVAILABLE' };
  return { state: 'AVAILABLE', value };
}

// Metadata only. Never return values to log callers.
export function inspectMetadata(entries) {
  return inspect(entries).state;
}

export function evaluate(core, ui) {
  const a = inspect(core);
  const b = inspect(ui);
  if (a.state !== 'AVAILABLE' || b.state !== 'AVAILABLE') return 'UNVERIFIABLE';
  const x = Buffer.from(a.value);
  const y = Buffer.from(b.value);
  return x.length === y.length && timingSafeEqual(x, y) ? 'MATCH' : 'MISMATCH';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4) throw new Error('files missing');
    const core = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const ui = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    console.log('coolify_production_gateway_config=' + evaluate(core, ui));
    console.log('coolify_core_gateway_key=' + inspectMetadata(core));
    console.log('coolify_ui_gateway_key=' + inspectMetadata(ui));
  } catch {
    console.log('coolify_production_gateway_config=UNVERIFIABLE');
    console.log('coolify_gateway_metadata=UNAVAILABLE');
    process.exitCode = 3;
  }
}
