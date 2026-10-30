// Every command beyond the G1-G3 set registers itself when its module loads; importing this makes
// sure they are all in COMMANDS before anything is normalised.

import './cmd-layers.ts';
import './cmd-select.ts';
import './cmd-transform.ts';
import './cmd-shapes.ts';
import './cmd-art.ts';
import './cmd-gen.ts';
import './cmd-structure.ts';
import './cmd-stamps.ts';
import './cmd-macros.ts';
import './cmd-anim.ts';
import './cmd-family.ts';
import './cmd-map.ts';
import './cmd-io.ts';
import './cmd-plan.ts';
import './cmd-font.ts';
import './cmd-underlay.ts';
import { COMMANDS } from './commands.ts';

/** Every command's one-line form, from the registry (the headless worker's command reference). */
export function commandReference(): string {
  return [...COMMANDS.values()].map((c) => c.summary).join('\n');
}
