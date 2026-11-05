// Whether anyone will pick up a request. A request a person files is only a line in
// requests.jsonl until an agent hears of it, so a card says "sent", then "seen by <agent>", and
// when nobody is listening (or nobody has seen it for a couple of minutes) it says that plainly
// and offers a prompt to hand to Claude Code, or the worker when the project allows it.

import { useEffect, useState } from 'react';
import type { WorkRequest } from '@pixelclaw/core';
import type { Store } from './store.ts';
import { promptFor, shownDir } from './prompt.ts';

/** How long an open request may go unseen before the card says so (the server uses the same figure). */
export const UNSEEN_MS = 2 * 60 * 1000;

/** The time, refreshed every few seconds so "unseen for two minutes" shows up without an event. */
export function useNow(everyMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** When the request last asked for attention: filed, or answered. */
function askedAt(q: WorkRequest): number {
  const reply = q.events.filter((e) => e.type === 'reply').at(-1);
  return Date.parse(reply?.at ?? q.at);
}

/** An open request nobody has: no one is listening, or it has gone unseen too long. */
export function unattended(store: Store, q: WorkRequest, now: number): boolean {
  if (q.state !== 'open' || (q.seen ?? []).length) return false;
  const p = store.presence;
  if (!p) return false;
  return !p.listening || now - askedAt(q) > UNSEEN_MS;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The honest answer when nobody has a request: why, and the two ways to get someone on it. */
export function NoListener({ store, why }: { store: Store; why: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const dir = store.project?.dir ? shownDir(store.project.dir, store.project.home) : '<project folder>';
  const prompt = promptFor(dir);
  const w = store.worker;
  return (
    <div className="no-listener" data-testid="no-listener" role="status">
      <div><b>⚠ {why}</b></div>
      <div className="card-actions">
        <button onClick={() => void copy(prompt).then(setCopied)} data-testid="copy-prompt" title="Copy a prompt to paste into a Claude Code session">Copy prompt for Claude</button>
        {w?.enabled && !w.running && (
          <button className="ask-claude" disabled={busy} data-testid="start-worker"
            onClick={() => { setBusy(true); void store.workerAction('start').then((r) => { setBusy(false); store.error = r.ok ? null : r.error ?? 'refused'; store.changed(); }); }}
            title="Run Claude Code headless on the open requests, up to the project's budget cap">Start the worker</button>
        )}
      </div>
      {copied !== null && (
        <div className="dim" data-testid="prompt-copied">
          {copied ? 'Copied. Paste it into a Claude Code session in this project.' : 'Could not copy; select the prompt below.'}
          <pre className="prompt-text" data-testid="prompt-text">{prompt}</pre>
        </div>
      )}
    </div>
  );
}

/** The header's listening indicator. */
export function ListenerChip({ store }: { store: Store }) {
  const p = store.presence;
  if (!p) return null;
  const who = p.worker ? 'the worker' : p.waiters.length ? p.waiters[0]!.by : p.agents[0]?.by ?? '';
  return (
    <span className={`chip listener-chip ${p.listening ? 'on' : 'off'}`} data-testid="listener-chip" data-listening={p.listening}
      title={p.listening ? 'An agent is waiting for requests, took a request recently, or the worker is running' : 'Requests you file now wait until an agent is started on this project'}>
      {p.listening ? `● ${who} is listening` : '○ no agent is listening'}
    </span>
  );
}
