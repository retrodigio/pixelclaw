// Screenshots for G13 (docs/screenshots/g13-*.png), from the demo's project (run
// `node examples/demo-g13-agent.ts` first): the Fern Ledge map in the editor with the fill tool,
// the glade with its walkable meadow, the map at the game's scale (faces drawn on the floor, the
// jittered cliff edge), the ledge family on a sample island, the stream bed tiled 3x3, and two
// tiles as the ledge-engine profile wrote them (five tones). Starts a server on a copy of the
// project, photographs it, and leaves nothing running.
//   node scripts/screenshots-g13.ts

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createRgba, decodePng, encodePng } from '../core/src/index.ts';
import { REPO, startAgent } from '../e2e/helpers.ts';

const out = (n: string) => join(REPO, 'docs', 'screenshots', `${n}.png`);
const DEMO = join(REPO, 'out', 'demo-g13.pclaw');
if (!existsSync(DEMO)) throw new Error('run node examples/demo-g13-agent.ts first');
const settled = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid=waiting]')?.textContent === '');

/** PNGs side by side, each enlarged k times, on a background colour. */
function strip(srcs: string[], dst: string, k: number, bg: [number, number, number]): void {
  const imgs = srcs.map((f) => decodePng(readFileSync(f)));
  const gap = 4 * k;
  const W = imgs.reduce((s, i) => s + i.width * k + gap, gap), H = Math.max(...imgs.map((i) => i.height * k)) + 2 * gap;
  const o = createRgba(W, H);
  for (let i = 0; i < W * H; i++) o.data.set([...bg, 255], i * 4);
  let x0 = gap;
  for (const img of imgs) {
    for (let y = 0; y < img.height * k; y++) for (let x = 0; x < img.width * k; x++) {
      const i = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
      if (img.data[i + 3]) o.data.set(img.data.subarray(i, i + 4), ((y + gap) * W + x0 + x) * 4);
    }
    x0 += img.width * k + gap;
  }
  writeFileSync(dst, encodePng(o));
}

const ex = join(DEMO, 'exports', 'ledge-engine');
strip(['ledge_nesw_nw_ne_se_sw', 'ledge_face_ew', 'trail_end_n', 'trail_run_ns', 'rock'].map((n) => join(ex, `${n}.png`)), out('g13-export-tones'), 6, [40, 30, 50]);

const agent = await startAgent({ copy: DEMO });
const browser = await chromium.launch();
try {
  // Each view says where it saved its image.
  const view = async (a: Record<string, unknown>, name: string) => {
    const r = await agent.call('view', a);
    const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
    copyFileSync(/saved (\S+\.png)/.exec(text)![1]!, out(name));
  };
  await view({ asset: 'fern_ledge', mode: 'map', region: '0,0 12x8' }, 'g13-fern-ledge-map');
  await view({ asset: 'ledge', mode: 'map', size: '10x8', seed: 3 }, 'g13-ledge-island');
  await view({ asset: 'bed', mode: 'tile3x3' }, 'g13-bed-tile3x3');

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${agent.url}&name=chris`);
  await page.getByTestId('status').getByText('live').waitFor();
  await page.locator('.follow input').uncheck();
  const pick = async (name: string) => {
    await page.locator('.assets li').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}($|\\s*⑂)`) }) }).click();
    await settled(page);
  };
  await pick('fern_ledge');
  await page.getByTestId('map-editor').waitFor();
  await page.getByTestId('map-zoom-2').click();
  await page.locator('[data-tool="fill"]').click();
  const box = (await page.getByTestId('map-edit-canvas').boundingBox())!;
  await page.mouse.move(box.x + 5.5 * 32, box.y + 6.5 * 32);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('g13-map-fill') });

  await pick('glade');
  await page.getByTestId('map-editor').waitFor();
  await page.getByTestId('map-zoom-2').click();
  await page.locator('[data-tool="brush"]').click();
  const gb = (await page.getByTestId('map-edit-canvas').boundingBox())!;
  await page.mouse.move(gb.x + 1.5 * 32, gb.y + 1.5 * 32);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('g13-map-walkable') });
} finally {
  await browser.close();
  await agent.close();
}
console.log('wrote docs/screenshots/g13-*.png');
