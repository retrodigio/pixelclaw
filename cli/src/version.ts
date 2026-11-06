// The version printed by `pixelclaw --version`: the package's own, read from package.json when
// the sources run directly, or baked into the bundle at build time (scripts/build.ts defines it).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __PIXELCLAW_VERSION__: string | undefined;

export function pixelclawVersion(): string {
  if (typeof __PIXELCLAW_VERSION__ === 'string') return __PIXELCLAW_VERSION__;
  try {
    return (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}
