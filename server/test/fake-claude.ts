// A stand-in for the Claude Code CLI (`claude -p`) in tests: it takes the same arguments the
// worker passes, connects to the MCP server named in --mcp-config over HTTP, works the request
// queue through the `work` tool like an agent would, and prints stream-json lines ending in a
// result with a made-up cost. It never calls a model and never spends money.
//
// Its own options (the worker's `args` setting passes them through):
//   --fake-cost <usd>      the cost it reports (default 0.4)
//   --fake-mode draw|block|crash|idle
//                          draw: claim each request, draw planned assets (`new <kind> <name>`), done
//                          block: claim the first and block it with a question, then stop
//                          crash: print a line and exit 1 without a result
//                          idle: claim nothing
//   --fake-per-session <n> requests to take before ending the session (default: all)
//   --fake-sleep <ms>      wait before ending (to test stop and the single instance)

import { readFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const out = (j: unknown) => process.stdout.write(JSON.stringify(j) + '\n');

const cost = Number(opt('--fake-cost') ?? 0.4);
const mode = opt('--fake-mode') ?? 'draw';
const per = Number(opt('--fake-per-session') ?? 1000);
const sleep = Number(opt('--fake-sleep') ?? 0);
const budget = Number(opt('--max-budget-usd') ?? Infinity);
for (const need of ['-p', '--mcp-config', '--output-format', '--max-budget-usd', '--allowedTools']) {
  if (!argv.includes(need)) { process.stderr.write(`fake-claude: missing ${need}\n`); process.exit(2); }
}

out({ type: 'system', subtype: 'init', model: 'fake-claude', tools: [] });
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
const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
  turns++;
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: `mcp__pixelclaw__${name}`, input: args }] } });
  const r = (await client.callTool({ name, arguments: args })) as { content: { text?: string }[]; isError?: boolean };
  const t = r.content.map((c) => c.text ?? '').join('\n');
  out({ type: 'user', message: { content: [{ type: 'tool_result', is_error: !!r.isError, content: t.slice(0, 200) }] } });
  return t;
};

if (mode !== 'idle') {
  await call('plan', {});
  for (let n = 0; n < per; n++) {
    const t = await call('work', {});
    if (/no open requests/.test(t)) break;
    const m = /claimed (r\d+)\n\1 (draw|change|new asset) ([a-z][a-z0-9_-]*)/.exec(t);
    if (!m) break;
    const [, id, what, asset] = m;
    if (mode === 'block') {
      await call('work', { action: 'blocked', id, text: `Should ${asset} face left or right?` });
      break;
    }
    await call('work', { action: 'progress', id, text: `starting on ${asset}` });
    if (what !== 'change') {
      const kind = /plan: \S+ is an? (\w+)/.exec(t)?.[1] ?? 'sprite';
      await call('run', { asset, commands: `new ${kind} ${asset}` });
    }
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `${asset} is done.` }] } });
    await call('work', { action: 'done', id, text: what === 'change' ? `changed ${asset} as asked` : `drew ${asset}` });
  }
}
if (sleep) await new Promise((r) => setTimeout(r, sleep));
await client.close();
out({ type: 'result', subtype: 'success', num_turns: turns, total_cost_usd: cost, is_error: false, result: 'done' });
