// Requests from the dashboard: requests.jsonl in the project, one record a line, only
// ever appended. People open requests (Draw this, Ask for changes, Add an asset), answer a blocked
// one or withdraw one; the agent claims, posts progress and finishes them through the MCP `work`
// tool. Every record is checked against the state the file is in before it is written (core's
// state machine), so the file only holds records that fit.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  foldRequests, nextRequestId, openRequests, quote, requestProblem, validateManifest, type ManifestAsset, type RequestKind, type RequestRecord, type WorkRequest,
} from '@pixelclaw/core';
import { ProjectError, assetExists, type Project } from './project.ts';
import { MANIFEST_FILE, knownFor, manifestEntry, readManifest, writeManifest } from './plan.ts';
import type { PersonRequest } from './protocol.ts';
import { unseenOpen, type AgentEvent } from './await.ts';
import type { Writer } from './writer.ts';

export const REQUESTS_FILE = 'requests.jsonl';

/** Every record in the file, in order (a line that is not JSON is skipped). */
export function readRequestRecords(p: Project): RequestRecord[] {
  const f = join(p.dir, REQUESTS_FILE);
  if (!existsSync(f)) return [];
  const out: RequestRecord[] = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as RequestRecord);
    } catch {
      // a broken line (a hand edit): foldRequests reports nothing for it, it is simply not a record
    }
  }
  return out;
}

export function readRequests(p: Project): Map<string, WorkRequest> {
  return foldRequests(readRequestRecords(p)).requests;
}

/** Append one record if it fits; returns the request as it now stands. */
export function appendRequest(p: Project, r: RequestRecord): WorkRequest {
  const reqs = readRequests(p);
  const problem = requestProblem(reqs, r);
  if (problem) throw new ProjectError(problem);
  appendFileSync(join(p.dir, REQUESTS_FILE), JSON.stringify(r) + '\n');
  return foldRequests([...readRequestRecords(p)]).requests.get(r.id)!;
}

/**
 * A person's request, reply or cancel. "Draw this" is for a planned asset not drawn yet; "Ask for
 * changes" writes `mark rejected "…"` on the asset's tape with the person's name (as the dashboard's approval button
 * did) and records the request with that mark; "Add an asset" adds the manifest entry (the whole
 * manifest validated first; nothing is written if it has problems) and asks for it to be drawn.
 * Run inside the writer's queue.
 */
export function personRequest(w: Writer, by: string, q: PersonRequest): WorkRequest {
  const p = w.project;
  const at = w.stamp();
  if (q.action === 'reply') return appendRequest(p, { type: 'reply', id: q.id, by, at, text: String(q.text ?? '') });
  if (q.action === 'cancel') return appendRequest(p, { type: 'cancel', id: q.id, by, at, ...(q.text ? { text: q.text } : {}) });
  const reqs = readRequests(p);
  const id = nextRequestId(reqs);
  const note = (q.note ?? '').trim();
  const active = (asset: string, kind: RequestKind) => [...reqs.values()].find((x) => x.asset === asset && x.kind === kind && ['open', 'claimed', 'blocked'].includes(x.state));
  if (q.kind === 'new') {
    const e = q.entry;
    const mr = readManifest(p);
    if (!mr.manifest) throw new ProjectError(mr.exists ? `manifest.json has problems; fix it first (${mr.errors.map((x) => `${x.path}: ${x.message}`).join('; ')})` : 'there is no manifest yet: the agent writes the plan first');
    if (manifestEntry(mr.manifest, e?.name)) throw new ProjectError(`'${e.name}' is already in the manifest`);
    if (e?.name && assetExists(p, e.name)) throw new ProjectError(`an asset '${e.name}' already exists`);
    const next = { ...mr.manifest, assets: [...mr.manifest.assets, e] };
    const v = validateManifest(next, knownFor(p));
    if (!v.manifest) throw new ProjectError(`the new entry has problems: ${v.errors.map((x) => `${x.path}: ${x.message}`).join('; ')}`);
    // Check the record first, so a bad one writes nothing.
    const rec: RequestRecord = { type: 'request', id, asset: e.name, kind: 'new', note, by, at };
    const problem = requestProblem(reqs, rec);
    if (problem) throw new ProjectError(problem);
    writeManifest(p, next);
    w.planChanged();
    return appendRequest(p, rec);
  }
  const m = readManifest(p).manifest;
  if (q.kind === 'draw') {
    if (!manifestEntry(m, q.asset)) throw new ProjectError(`'${q.asset}' is not planned in ${MANIFEST_FILE}`);
    if (assetExists(p, q.asset)) throw new ProjectError(`'${q.asset}' is drawn already: ask for changes instead`);
    const dup = active(q.asset, 'draw');
    if (dup) throw new ProjectError(`${dup.id} already asks for '${q.asset}' (${dup.state})`);
    return appendRequest(p, { type: 'request', id, asset: q.asset, kind: 'draw', note, by, at });
  }
  if (!assetExists(p, q.asset)) throw new ProjectError(`'${q.asset}' is not drawn yet: ask for it to be drawn instead`);
  if (!note) throw new ProjectError('say what should change');
  const rec: RequestRecord = { type: 'request', id, asset: q.asset, kind: 'change', note, by, at };
  const problem = requestProblem(reqs, rec);
  if (problem) throw new ProjectError(problem);
  const r = w.hub.withoutMarkEvents(() => w.run({ asset: q.asset, commands: `mark rejected ${quote(note)}`, by }));
  if (!r.ok) throw new ProjectError(r.errors.map((e) => e.message).join('; '));
  return appendRequest(p, { ...rec, mark: r.added.at(-1)?.seq });
}

/** A request as one line: `r3 change urn: "taller" (from human:ana at …; claimed by claude)`. */
export function requestLine(q: WorkRequest): string {
  const what = q.kind === 'draw' ? `draw ${q.asset}` : q.kind === 'change' ? `change ${q.asset}` : `new asset ${q.asset}`;
  const state = q.state === 'claimed' ? `claimed by ${q.claimedBy}` : q.state === 'blocked' ? `blocked: "${q.question}"` : q.state;
  return `${q.id} ${what}${q.note ? `: "${q.note}"` : ''} (from ${q.by} at ${q.at}; ${state})`;
}

/**
 * A request, reply or cancel from the CLI or MCP as the dashboard's message:
 * kind draw, change or add (`new`, with its manifest entry). Checked here for shape; personRequest
 * checks it against the project.
 */
export function toPersonRequest(a: { action?: string; kind?: string; asset?: string; note?: string; entry?: Record<string, unknown>; id?: string; text?: string }): PersonRequest {
  const action = a.action ?? 'request';
  if (action === 'reply' || action === 'cancel') {
    if (!a.id || !/^r\d+$/.test(a.id)) throw new ProjectError(`${action}: give the request's id (like r3)`);
    if (action === 'reply') {
      if (!a.text?.trim()) throw new ProjectError('reply: give the answer (text)');
      return { action, id: a.id, text: a.text };
    }
    return { action, id: a.id, ...(a.text?.trim() ? { text: a.text } : {}) };
  }
  if (action !== 'request') throw new ProjectError(`unknown action '${action}' (request, reply, cancel)`);
  const kind = a.kind === 'new' ? 'add' : a.kind;
  if (kind === 'add') {
    if (!a.entry || typeof a.entry !== 'object') throw new ProjectError('add: give the new asset\'s manifest entry (name, kind, size, set, description)');
    return { action, kind: 'new', entry: a.entry as unknown as ManifestAsset, ...(a.note?.trim() ? { note: a.note } : {}) };
  }
  if (kind !== 'draw' && kind !== 'change') throw new ProjectError('a request\'s kind is draw, change or add');
  if (!a.asset) throw new ProjectError(`${kind}: give the asset`);
  if (kind === 'change') return { action, kind, asset: a.asset, note: a.note ?? '' };
  return { action, kind, asset: a.asset, ...(a.note?.trim() ? { note: a.note } : {}) };
}

/** Record that an agent was handed these requests (those still open and not seen by it yet). */
export function markSeen(w: Writer, ids: Iterable<string>, by: string): void {
  const reqs = readRequests(w.project);
  let wrote = false;
  for (const id of new Set(ids)) {
    const q = reqs.get(id);
    if (!q || q.state !== 'open' || q.seen.some((x) => x.by === by)) continue;
    appendRequest(w.project, { type: 'seen', id, by, at: w.stamp() });
    wrote = true;
  }
  if (wrote) w.requestsChanged();
}

/** The most seconds one await may wait (the CLI's and the HTTP endpoint's cap; MCP asks for less). */
export const MAX_AWAIT_S = 3600;

/**
 * Wait for what people did (a request, reply or cancel; an approval or rejection) after a cursor.
 * The requests it hands over are recorded as seen by `by`.
 */
export async function awaitRequests(w: Writer, o: { cursor?: string; timeoutS: number; by: string; via: 'cli' | 'mcp'; signal?: AbortSignal }): Promise<{ events: AgentEvent[]; cursor: string; timedOut: boolean }> {
  const timeoutMs = Math.max(0, Math.min(MAX_AWAIT_S, o.timeoutS)) * 1000;
  const r = await w.hub.wait({ cursor: o.cursor, initial: () => unseenOpen(readRequests(w.project)), timeoutMs, by: o.by, via: o.via, signal: o.signal });
  if (r.events.length) await w.enqueue(() => markSeen(w, r.events.filter((e) => (e.kind === 'request' || e.kind === 'reply') && e.id).map((e) => e.id!), o.by));
  return r;
}

/** The note `plan` adds when open requests have nobody waiting to take them (empty when an await is waiting, the worker runs, or none is open). */
export function listenerNote(w: Writer): string {
  const open = [...readRequests(w.project).values()].filter((q) => q.state === 'open');
  // Calling plan or work does not make an agent a listener for new requests; a waiting await or the worker does.
  const pr = w.hub.presence();
  if (!open.length || pr.waiters.length || pr.worker) return '';
  return `${open.length} open request${open.length === 1 ? '' : 's'} and no agent is listening for ${open.length === 1 ? 'it' : 'them'}. Take ${open.length === 1 ? 'it' : 'them'} with work, and keep \`pixelclaw await <project>\` running in the background (or call await_requests) so people's next requests reach you.`;
}

/** The agent's side (the MCP `work` tool). */
export type AgentWork =
  | { action: 'next'; id?: string }
  | { action: 'progress' | 'done' | 'blocked'; id?: string; text: string }
  | { action: 'list' };

/** The request this agent has claimed and not finished (the newest), if any. */
function mine(reqs: Map<string, WorkRequest>, agent: string): WorkRequest | undefined {
  return [...reqs.values()].filter((q) => q.state === 'claimed' && q.claimedBy === agent).at(-1);
}

export function agentWork(w: Writer, agent: string, q: AgentWork): { request: WorkRequest | null; message: string } {
  const p = w.project;
  const reqs = readRequests(p);
  const at = w.stamp();
  w.hub.touch(agent);
  if (q.action === 'list') {
    markSeen(w, openRequests(reqs).filter((x) => x.state === 'open').map((x) => x.id), agent);
    return { request: null, message: '' };
  }
  if (q.action === 'next') {
    const held = q.id ? undefined : mine(reqs, agent);
    if (held) return { request: held, message: `you already have ${held.id}; finish it (done or blocked) before taking another` };
    const target = q.id ? reqs.get(q.id) : openRequests(reqs).find((x) => x.state === 'open');
    if (!target) return { request: null, message: q.id ? `no request ${q.id}` : 'no open requests' };
    if (target.state === 'open' && !target.seen.some((x) => x.by === agent)) appendRequest(p, { type: 'seen', id: target.id, by: agent, at });
    return { request: appendRequest(p, { type: 'claim', id: target.id, by: agent, at }), message: `claimed ${target.id}` };
  }
  const id = q.id ?? mine(reqs, agent)?.id;
  if (!id) throw new ProjectError(`no claimed request to post ${q.action} on (give id)`);
  const target = reqs.get(id);
  if (q.action === 'done' && target && target.state === 'claimed' && target.claimedBy === agent) {
    // Done means the asset passes its checks; blocked stays open for anything else.
    if (!assetExists(p, target.asset)) throw new ProjectError(`${id} is not done: ${target.asset} is not drawn yet. Draw it, or work(action="blocked", text=<one clear question>) if you cannot`);
    const failing = w.checks(target.asset).results.filter((r) => r.status === 'fail');
    if (failing.length) {
      throw new ProjectError(`${id} is not done: ${target.asset} fails ${failing.length} check${failing.length === 1 ? '' : 's'}:\n` +
        failing.map((r) => `  ${r.id}${r.score !== null ? ` ${r.shown}` : ''}${r.limit ? ` (limit ${r.limit})` : ''}${r.detail ? `: ${r.detail}` : ''}`).join('\n') +
        `\nFix ${failing.length === 1 ? 'it' : 'them'} (check shows the pixels) and finish again, or work(action="blocked", text=<one clear question>) if you cannot.`);
    }
  }
  const r = appendRequest(p, { type: q.action, id, by: agent, at, text: q.text });
  return { request: r, message: `${id}: ${q.action}` };
}
