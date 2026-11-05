// The prompt the dashboard offers when nobody is listening: one text that works for a Claude Code
// session with PixelClaw's MCP tools and for one that only has the pixelclaw command.
import { describe, expect, it } from 'vitest';
import { promptFor, shellQuote, shownDir } from '../ui/src/prompt.ts';

describe('the copy prompt', () => {
  const p = promptFor('~/art/ruins.pclaw');

  it('keeps an await running in the background and restarts it from the cursor', () => {
    expect(p).toContain('the project at ~/art/ruins.pclaw.');
    expect(p).toContain('Run `pixelclaw await ~/art/ruins.pclaw` in the background');
    expect(p).toContain('start `pixelclaw await ~/art/ruins.pclaw --since <the cursor it printed>` in the background again');
  });

  it('with MCP: the work tool', () => {
    expect(p).toContain("If you have PixelClaw's MCP tools, use the work tool: claim it, draw or change the art, post progress, finish it with done, or ask one question with blocked.");
  });

  it('without MCP: the exact pixelclaw work commands', () => {
    for (const c of [
      '`pixelclaw work ~/art/ruins.pclaw claim`',
      '`pixelclaw run ~/art/ruins.pclaw -e "<commands>"`',
      '`pixelclaw work ~/art/ruins.pclaw progress "<note>"`',
      '`pixelclaw work ~/art/ruins.pclaw done "<what changed>"`',
      '`pixelclaw work ~/art/ruins.pclaw block "<one clear question>"`',
    ]) expect(p).toContain(c);
    expect(p).toContain('refused while a check fails');
  });

  it('shows a folder under home as ~/…, and quotes what the shell would split', () => {
    expect(shownDir('/home/ana/art/ruins.pclaw', '/home/ana')).toBe('~/art/ruins.pclaw');
    expect(shownDir('/home/anabel/x', '/home/ana')).toBe('/home/anabel/x');
    expect(shownDir('/srv/art/x', undefined)).toBe('/srv/art/x');
    expect(shellQuote('~/my art/ruins.pclaw')).toBe("~/'my art/ruins.pclaw'");
    expect(shellQuote("/srv/it's")).toBe("'/srv/it'\\''s'");
    expect(promptFor('/srv/my art')).toContain("`pixelclaw work '/srv/my art' claim`");
  });
});
