// The prompt the dashboard offers when nobody is listening: what to paste into a Claude Code
// session so it hears of requests and works them. No DOM here, so the text is tested on its own.

/** A word for a shell command line, quoted when it needs to be. */
export function shellQuote(s: string): string {
  // A leading ~/ stays outside the quotes so the shell still expands it.
  if (s.startsWith('~/')) return `~/${shellQuote(s.slice(2))}`;
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The project folder as a person types it: under the home folder, as ~/…. */
export function shownDir(dir: string, home?: string): string {
  if (!home || home === '/') return dir;
  const h = home.replace(/\/+$/, '');
  return dir === h ? '~' : dir.startsWith(`${h}/`) ? `~${dir.slice(h.length)}` : dir;
}

/**
 * The prompt to give a Claude Code session so it works this project's requests as they arrive:
 * with PixelClaw's MCP work tool if the session has it, else with the `pixelclaw work` commands.
 */
export function promptFor(dir: string): string {
  const d = shellQuote(dir);
  const cmd = `pixelclaw await ${d}`;
  const work = `pixelclaw work ${d}`;
  return `People ask for changes in the PixelClaw dashboard for the project at ${dir}. Run \`${cmd}\` in the background (it waits, prints what was asked and a cursor, then exits). Each time it exits, read what it printed and take each request. ` +
    `If you have PixelClaw's MCP tools, use the work tool: claim it, draw or change the art, post progress, finish it with done, or ask one question with blocked. ` +
    `Otherwise use the CLI: \`${work} claim\` (prints what is asked), draw with \`pixelclaw run ${d} -e "<commands>"\` and look with \`pixelclaw view\` and \`pixelclaw check\`, post \`${work} progress "<note>"\`, finish with \`${work} done "<what changed>"\` (refused while a check fails: fix it and finish again), or ask with \`${work} block "<one clear question>"\`. ` +
    `Then start \`${cmd} --since <the cursor it printed>\` in the background again. Keep doing this until I say stop.`;
}
