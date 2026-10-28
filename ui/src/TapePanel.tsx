// The tape: every command of the shown asset, grouped by undo group and coloured by author. The
// line being played is highlighted; lines not played yet are dimmed. Clicking a line shows the
// document as it was right after it (time travel). The list is virtualised: rows have fixed
// heights (a command's text does not wrap; a paint block takes one row per line), so only the rows
// in view are in the page, and a tape of 10,000 lines scrolls as easily as a short one.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TapeEntry } from '@pixelclaw/core';
import type { AssetModel } from './store.ts';

export function authorClass(by: string): string {
  if (by === 'claude') return 'by-claude';
  if (by.startsWith('human')) return 'by-human';
  return 'by-other';
}

/** The tape's UTC stamp as local time. */
export function time(at: string | undefined): string {
  return at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

/** Row heights in CSS pixels; styles.css gives the rows these heights. */
export const LINE_H = 18;
export const GROUP_H = 28;
/** Rows drawn beyond the visible part, above and below. */
const OVERSCAN = 600;

interface Row {
  kind: 'group' | 'cmd';
  e: TapeEntry;
  /** Index in the tape (commands only). */
  i: number;
  top: number;
  h: number;
}

function layout(tape: TapeEntry[]): { rows: Row[]; height: number; topOf: Map<number, number> } {
  const rows: Row[] = [];
  const topOf = new Map<number, number>();
  let y = 0;
  let group: string | null = null;
  tape.forEach((e, i) => {
    if (e.group !== group) {
      group = e.group;
      rows.push({ kind: 'group', e, i, top: y, h: GROUP_H });
      y += GROUP_H;
    }
    const h = LINE_H * (1 + (e.cmd.match(/\n/g)?.length ?? 0));
    topOf.set(e.seq, y);
    rows.push({ kind: 'cmd', e, i, top: y, h });
    y += h;
  });
  return { rows, height: y + 8, topOf };
}

/** The first row whose bottom is below y (rows are sorted by top). */
function firstBelow(rows: Row[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.top + rows[mid]!.h <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Props {
  asset: AssetModel | undefined;
  undone: Set<string>;
  travel: number | null;
  follow: boolean;
  onPick(seq: number): void;
}

export function TapePanel({ asset, undone, travel, follow, onPick }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, h: 600 });
  const shown = asset?.cursor.done.length ?? 0;
  const head = asset && shown > 0 ? asset.tape[shown - 1]!.seq : null;
  const tape = asset?.tape;
  const n = tape?.length ?? 0;
  const { rows, height, topOf } = useMemo(() => layout(tape ?? []), [tape, n]);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the playhead in view while playing live.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || travel !== null || !follow || head === null) return;
    const top = topOf.get(head);
    if (top === undefined) return;
    if (top < el.scrollTop || top + LINE_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top + LINE_H - el.clientHeight + 8);
      setView({ top: el.scrollTop, h: el.clientHeight });
    }
  }, [head, travel, follow, topOf]);

  if (!asset) return <div className="tape-list" ref={list} data-testid="tape" />;
  const from = firstBelow(rows, view.top - OVERSCAN);
  const out: React.ReactNode[] = [];
  for (let k = from; k < rows.length && rows[k]!.top < view.top + view.h + OVERSCAN; k++) {
    const { kind, e, i, top, h } = rows[k]!;
    const style = { top, height: h };
    if (kind === 'group') {
      out.push(
        <div key={`g-${e.group}-${e.seq}`} style={style} className={`group-row ${authorClass(e.by)}${undone.has(e.group) ? ' undone' : ''}`}>
          <span className="author">{e.by}</span>
          <span className="gid">{e.group}</span>
          {undone.has(e.group) && <span className="tag">undone</span>}
          <span className="at">{time(e.at)}</span>
        </div>,
      );
      continue;
    }
    const [first, ...more] = e.cmd.split('\n');
    const state = i < shown ? (e.seq === head ? ' head' : '') : ' pending';
    out.push(
      <div
        key={e.seq}
        data-seq={e.seq}
        style={style}
        className={`cmd-row ${authorClass(e.by)}${state}${undone.has(e.group) ? ' undone' : ''}${travel === e.seq ? ' picked' : ''}${travel !== null && e.seq > travel ? ' future' : ''}`}
        title={`#${e.seq} by ${e.by}, group ${e.group}${e.at ? `, ${e.at}` : ''}. Click to see the document at this point.\n${e.cmd}`}
        onClick={() => onPick(e.seq)}
      >
        <span className="seq">#{e.seq}</span>
        <span className="cmd">
          {first}
          {more.length > 0 && <span className="block">{more.join('\n')}</span>}
        </span>
      </div>,
    );
  }
  return (
    <div
      className="tape-list"
      ref={list}
      data-testid="tape"
      data-lines={n}
      onScroll={(ev) => setView({ top: ev.currentTarget.scrollTop, h: ev.currentTarget.clientHeight })}
    >
      <div className="tape-inner" style={{ height }}>{out}</div>
    </div>
  );
}
