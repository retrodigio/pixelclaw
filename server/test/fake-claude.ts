// A stand-in for the Claude Code CLI (`claude -p`) in tests: it takes the same arguments the
// worker passes, connects to the MCP server named in --mcp-config over HTTP, works the request
// queue through the `work` tool like an agent would, and prints stream-json lines ending in a
// result with a made-up cost. It never calls a model and never spends money.
//
// Its own options come after the program in the worker's `command` setting (the worker's `args`
// take only --model, --fallback-model and --effort):
//   --fake-cost <usd>      the cost it reports (default 0.4)
//   --fake-mode draw|fix|block|crash|idle|stall
//                          draw: claim each request, draw it so its checks pass, done
//                          fix: draw it with a fault (no outline, or a seam), have done refused,
//                               fix the fault the reply names, then done
//                          block: claim the first and block it with a question, then stop
//                          crash: print a line and exit 1 without a result
//                          idle: claim nothing
//                          stall: claim one request, then go quiet (no tool call) until stopped;
//                               resumed (--resume), it finishes the request, unless
//                               --fake-stall-again, when it goes quiet again
//                          probe: try paths outside the project through the PixelClaw tools
//                               (FAKE_CLAUDE_PROBE: a JSON list of [tool, arguments]) and record the
//                               answers, then claim nothing
//   --fake-per-session <n> requests to take before ending the session (default: all)
//   --fake-sleep <ms>      wait before ending (to test stop and the single instance)
// With FAKE_CLAUDE_RECORD set, it appends { argv } (one JSON line) to that file first, and
// { probe: [...] } after a probe.

import { appendFileSync, readFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const argv = process.argv.slice(2);
const record = (j: unknown) => { if (process.env.FAKE_CLAUDE_RECORD) appendFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify(j) + '\n'); };
record({ argv });
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const out = (j: unknown) => process.stdout.write(JSON.stringify(j) + '\n');

const cost = Number(opt('--fake-cost') ?? 0.4);
const mode = opt('--fake-mode') ?? 'draw';
const per = Number(opt('--fake-per-session') ?? 1000);
const sleep = Number(opt('--fake-sleep') ?? 0);
const budget = Number(opt('--max-budget-usd') ?? Infinity);
const resumed = opt('--resume');
for (const need of ['-p', '--mcp-config', '--output-format', '--max-budget-usd', '--allowedTools', '--tools']) {
  if (!argv.includes(need)) { process.stderr.write(`fake-claude: missing ${need}\n`); process.exit(2); }
}

out({ type: 'system', subtype: 'init', model: 'fake-claude', session_id: resumed ?? `fake-${process.pid}`, tools: opt('--tools') === '' ? [] : ['Bash', 'Read'] });
if (mode === 'crash') { out({ type: 'assistant', message: { content: [{ type: 'text', text: 'about to fall over' }] } }); process.exit(1); }
if (budget < cost) {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: `a session costs ${cost}; only ${budget} left` }] } });
  out({ type: 'result', subtype: 'error_max_budget_usd', num_turns: 0, total_cost_usd: budget, is_error: true });
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(opt('--mcp-config')!, 'utf8')) as { mcpServers: { pixelclaw: { url: string; headers: Record<string, string> } } };
const server = cfg.mcpServers.pixelclaw;
const client = new Client({ name: 'fake-claude', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
let turns = 0;
const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; error: boolean }> => {
  turns++;
  out({ type: 'assistant', message: { id: `m${turns}`, content: [{ type: 'tool_use', name: `mcp__pixelclaw__${name}`, input: args }], usage: { input_tokens: 1000, output_tokens: 100 } } });
  const r = (await client.callTool({ name, arguments: args })) as { content: { text?: string }[]; isError?: boolean };
  const t = r.content.map((c) => c.text ?? '').join('\n');
  out({ type: 'user', message: { content: [{ type: 'tool_result', is_error: !!r.isError, content: t.slice(0, 200) }] } });
  return { text: t, error: !!r.isError };
};
const say = (text: string) => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const quiet = () => new Promise(() => setInterval(() => undefined, 60_000)); // never resolves: the watchdog stops us

/** Simple art that passes every check: a filled tile, or a shape with an ink outline (one of three, by request, so a set's silhouettes differ). */
function art(kind: string, size: string, faulty: boolean, n: number): string {
  const [w, h] = (/^(\d+)x(\d+)$/.exec(size) ?? [, '16', '16']).slice(1).map(Number) as [number, number];
  if (kind === 'tile') return `fill 0,0 c=moss1${faulty ? `\nrect 0,0 ${w / 2}x${h} c=soil2 fill` : ''}`;
  const shape = [`ellipse 3,3 ${w - 6}x${h - 6}`, `ellipse 4,2 ${w - 8}x${h - 4}`, `rect 5,2 ${w - 10}x${h - 4}`][n % 3];
  return `${shape} c=stone3 fill${faulty ? '' : '\noutline c=ink'}`;
}

/** Draw or change a claimed request and finish it. */
async function finish(id: string, what: string, asset: string, brief: string): Promise<void> {
  await call('work', { action: 'progress', id, text: `starting on ${asset}` });
  const m = /plan: \S+ is an? (\w+) (\d+x\d+)/.exec(brief);
  const [kind, size] = [m?.[1] ?? 'sprite', m?.[2] ?? '16x16'];
  if (what !== 'change') await call('run', { asset, commands: `new ${kind} ${asset}\n${art(kind, size, mode === 'fix', Number(id.slice(1)) - 1)}` });
  say(`${asset} is done.`);
  let r = await call('work', { action: 'done', id, text: what === 'change' ? `changed ${asset} as asked` : `drew ${asset}` });
  if (r.error && mode === 'fix') {
    // The reply lists the failing checks: fix the one this fault causes, then finish again.
    say(`done was refused: ${r.text.split('\n')[0]}`);
    await call('run', { asset, commands: /seam/.test(r.text) ? `rect 0,0 ${Number(size.split('x')[0]) / 2}x${size.split('x')[1]} c=moss1 fill` : 'outline c=ink' });
    r = await call('work', { action: 'done', id, text: `drew ${asset}, then fixed what the checks found` });
  }
}

if (mode === 'probe') {
  const probes = JSON.parse(process.env.FAKE_CLAUDE_PROBE ?? '[]') as [string, Record<string, unknown>][];
  const answers: { tool: string; error: boolean; text: string }[] = [];
  for (const [tool, args] of probes) {
    try {
      answers.push({ tool, ...(await call(tool, args)) });
    } catch (e) {
      answers.push({ tool, error: true, text: (e as Error).message }); // a tool the server does not offer
    }
  }
  record({ probe: answers });
} else if (resumed && mode === 'stall') {
  if (argv.includes('--fake-stall-again')) await quiet();
  // work with no action hands back the request this session already holds, with its brief.
  const t = (await call('work', {})).text;
  const m = /you already have (r\d+)[^\n]*\n\1 (draw|change|new asset) ([a-z][a-z0-9_-]*)/.exec(t);
  if (m) await finish(m[1]!, m[2]!, m[3]!, t);
} else if (mode !== 'idle') {
  await call('plan', {});
  for (let n = 0; n < per; n++) {
    const t = (await call('work', {})).text;
    if (/no open requests/.test(t)) break;
    const m = /claimed (r\d+)\n\1 (draw|change|new asset) ([a-z][a-z0-9_-]*)/.exec(t);
    if (!m) break;
    const [, id, what, asset] = m;
    if (mode === 'block') {
      await call('work', { action: 'blocked', id, text: `Should ${asset} face left or right?` });
      break;
    }
    if (mode === 'stall') { say(`thinking about ${asset}…`); await quiet(); }
    await finish(id!, what!, asset!, t);
  }
}
if (sleep) await new Promise((r) => setTimeout(r, sleep));
await client.close();
out({ type: 'result', subtype: 'success', num_turns: turns, total_cost_usd: cost, is_error: false, result: 'done' });
