// The tape: every command of the shown asset, grouped by undo group and coloured by author. The
// line being played is highlighted; lines not played yet are dimmed. Clicking a line shows the
// document as it was right after it (read-only time travel).

import { useEffect, useRef } from 'react';
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

interface Props {
  asset: AssetModel | undefined;
  undone: Set<string>;
  travel: number | null;
  follow: boolean;
  onPick(seq: number): void;
}

export function TapePanel({ asset, undone, travel, follow, onPick }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const shown = asset?.cursor.done.length ?? 0;
  const head = asset && shown > 0 ? asset.tape[shown - 1]!.seq : null;

  // Keep the playhead in view while playing live.
  useEffect(() => {
    if (travel !== null || !follow || head === null) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-seq="${head}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [head, travel, follow]);

  if (!asset) return <div className="tape-list" ref={list} />;
  const rows: React.ReactNode[] = [];
  let group: string | null = null;
  asset.tape.forEach((e: TapeEntry, i) => {
    if (e.group !== group) {
      group = e.group;
      rows.push(
        <div key={`g-${e.group}-${e.seq}`} className={`group-row ${authorClass(e.by)}${undone.has(e.group) ? ' undone' : ''}`}>
          <span className="author">{e.by}</span>
          <span className="gid">{e.group}</span>
          {undone.has(e.group) && <span className="tag">undone</span>}
          <span className="at">{time(e.at)}</span>
        </div>,
      );
    }
    const [first, ...more] = e.cmd.split('\n');
    const state = i < shown ? (e.seq === head ? ' head' : '') : ' pending';
    rows.push(
      <div
        key={e.seq}
        data-seq={e.seq}
        className={`cmd-row ${authorClass(e.by)}${state}${undone.has(e.group) ? ' undone' : ''}${travel === e.seq ? ' picked' : ''}${travel !== null && e.seq > travel ? ' future' : ''}`}
        title={`#${e.seq} by ${e.by}, group ${e.group}${e.at ? `, ${e.at}` : ''}. Click to see the document at this point.`}
        onClick={() => onPick(e.seq)}
      >
        <span className="seq">#{e.seq}</span>
        <span className="cmd">
          {first}
          {more.length > 0 && <span className="block">{more.join('\n')}</span>}
        </span>
      </div>,
    );
  });
  return <div className="tape-list" ref={list} data-testid="tape">{rows}</div>;
}
