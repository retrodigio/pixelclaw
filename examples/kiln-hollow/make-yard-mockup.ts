// Makes the demo's offline mockup: so the walkthrough runs without an image API key, the
// "generated" draft of the kiln yard is made here, by the same code as the offline `fake`
// provider: a flat layout of a 6x4-tile scene (clay terraces, a sage bank, the stream) drawn as a
// rough pixel-art draft in the palette's colours, enlarged with a sub-pixel offset, blurred and
// given noise, so it looks like a generator's draft and snap has real work to do.
//   node examples/kiln-hollow/make-yard-mockup.ts
// writes examples/kiln-hollow/yard-layout.png (144x96, flat colours) and yard-mockup.png (768x512).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRgba, encodePng, rgbOf, type Palette } from '../../core/src/index.ts';
import { fakeDraft } from '../../server/src/underlay.ts';

const DIR = import.meta.dirname;
const palette = JSON.parse(readFileSync(join(DIR, 'kiln-hollow.json'), 'utf8')) as Palette;
const hex = (n: string) => rgbOf(palette.entries.find((e) => e.name === n)!.hex);
const W = 144, H = 96;
const layout = createRgba(W, H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // The stream along the bottom (its bank wavy), a sage bank in the top right, clay elsewhere.
  const bank = 70 + Math.round(4 * Math.sin(x / 9));
  const sage = (x - 150) ** 2 / 3200 + (y + 6) ** 2 / 2600 < 1;
  const c = y >= bank ? 'stream1' : sage ? 'sage2' : 'clay2';
  layout.data.set([...hex(c), 255], (y * W + x) * 4);
}
writeFileSync(join(DIR, 'yard-layout.png'), encodePng(layout));
const draft = fakeDraft({
  prompt: 'kiln hollow: red clay terraces, a sage bank, a silty stream; top-down pixel art, a draft',
  size: [768, 512], layout: null, model: 'draft', quality: 'medium', grid: [W, H], palette, layoutImage: layout,
});
writeFileSync(join(DIR, 'yard-mockup.png'), encodePng(draft));
console.log('wrote yard-layout.png and yard-mockup.png');
