// core must stay host-free and deterministic (plan §8.1): no clock, no Math.random, no DOM or Node.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(new URL('.', import.meta.url).pathname, '..', 'src');
const FORBIDDEN = [/\bDate\b/, /Math\.random/, /\bprocess\b/, /\brequire\(/, /\bwindow\./, /\bdocument\./, /\bBuffer\b/, /\bTextEncoder\b/, /from 'node:/, /\bperformance\b/, /\bsetTimeout\b/];

describe('core sources', () => {
  it('use no clock, no Math.random, and no host APIs', () => {
    for (const f of readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
      const code = readFileSync(join(SRC, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const re of FORBIDDEN) expect(re.test(code), `${f} uses ${re}`).toBe(false);
    }
  });
});
