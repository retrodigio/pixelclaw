// A stand-in for the model behind Claude Code: a local HTTP server that speaks enough of the
// Anthropic Messages API (streamed or not) for the real `claude` CLI to run against it with
// ANTHROPIC_BASE_URL. It never reaches a real model and costs nothing. Each turn of the main
// conversation (the requests that offer PixelClaw's `work` tool) asks `next` for one tool call,
// given what every earlier call came back with; `null` ends the turn. Other requests (titles,
// token counts) get a short text. Every request is kept, so a test can see what the model was
// offered and sent.

import { createServer, type Server } from 'node:http';

export interface FakeModel {
  /** The base URL for ANTHROPIC_BASE_URL. */
  url: string;
  /** Every request: the tool names it offered and its raw body. */
  requests: { tools: string[]; body: string }[];
  /** The main conversation's tool results so far, as text, in order. */
  results(): string[];
  close(): Promise<void>;
}

type Step = [string, Record<string, unknown>] | null;

const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? '').join('\n') : JSON.stringify(c));

export async function startFakeModel(next: (results: string[]) => Step, o: { endText?: string } = {}): Promise<FakeModel> {
  const requests: { tools: string[]; body: string }[] = [];
  let last: string[] = [];
  let n = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let j: { tools?: { name: string }[]; messages?: { content: unknown }[]; stream?: boolean; model?: string } = {};
      try { j = JSON.parse(body); } catch { /* not JSON */ }
      const tools = (j.tools ?? []).map((t) => t.name);
      requests.push({ tools, body });
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":10}'); return; }
      const main = tools.includes('mcp__pixelclaw__work');
      const results = (j.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; content?: unknown }[]) : []))
        .filter((c) => c.type === 'tool_result').map((c) => textOf(c.content));
      if (main) last = results;
      const step = main ? next(results) : null;
      const block = step ? { type: 'tool_use', id: `toolu_${++n}`, name: step[0], input: step[1] } : { type: 'text', text: o.endText ?? 'done' };
      const stop = step ? 'tool_use' : 'end_turn';
      const msg = { id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model, content: [] as unknown[], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } };
      if (!j.stream) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...msg, content: [block], stop_reason: stop })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (t: string, d: Record<string, unknown>) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
      ev('message_start', { message: msg });
      if (step) {
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: (block as { id: string }).id, name: step[0], input: {} } });
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step[1]) } });
      } else {
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: (block as { text: string }).text } });
      }
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 5 } });
      ev('message_stop', {});
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    requests,
    results: () => last,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** The environment for the real `claude` against the stand-in: a throwaway home, a dummy key, nothing else sent anywhere. */
export function fakeModelEnv(url: string, home: string): Record<string, string> {
  return {
    HOME: home, CLAUDE_CONFIG_DIR: `${home}/.claude`, ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key', ANTHROPIC_BASE_URL: url,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}
