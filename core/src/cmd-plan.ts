// Marks (plan §7.2, §7.3): `mark <name> ["text"]` names a point on the tape. Three names set an
// asset's status: `reviewed` (the agent, once a blind review's findings are dealt with),
// `approved` and `rejected` (a person, in the dashboard). Each mark keeps the art's hash, so a
// later change to the art makes it stale; undoing the group takes the mark away.

import { Args, fn, needDoc, registerCommand, type CommandSpec } from './commands.ts';
import { artHash } from './doc.ts';
import { DiagError, quote } from './parser.ts';

export const STATUS_MARKS = ['reviewed', 'approved', 'rejected'] as const;

const markCmd: CommandSpec = {
  name: 'mark',
  summary: 'mark <name> ["text"]   (names this point on the tape; reviewed, approved and rejected set the asset\'s status)',
  normalise(cmd, ctx) {
    needDoc(cmd, ctx);
    const a = new Args(cmd, []);
    const name = a.take('word', 'a mark name (reviewed, approved, rejected, or your own)');
    const t = a.peek()?.t === 'string' ? a.take('string', 'the text in quotes') : null;
    a.done();
    if (!/^[a-z][a-z0-9_-]*$/.test(name.v)) throw new DiagError(name.line, name.col, `mark names use a-z, 0-9, _ and -, starting with a letter`);
    const text = t ? t.v.trim() : '';
    if (t && text.length > 1000) throw new DiagError(t.line, t.col, `mark: the text is longer than 1000 characters`);
    const seq = ctx.seq;
    return {
      text: `mark ${name.v}${text ? ` ${quote(text)}` : ''}`,
      op: fn((d, by) => { d.marks = [...d.marks, { name: name.v, seq, by, text, art: artHash(d) }]; }),
    };
  },
};

registerCommand(markCmd);
