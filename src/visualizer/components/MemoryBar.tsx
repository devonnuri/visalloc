import { useMemo } from 'react';
import type { ArenaSnapshot } from '../../ptmalloc2';
import { CHUNK_OVERHEAD } from '../../ptmalloc2';
import { hex } from '../utils';

function maskSize(sz: number | null | undefined) {
  if (sz == null) return 0;
  return sz & ~0x7;
}

function orderedChunks(snap: ArenaSnapshot) {
  const addrs = Object.keys(snap.chunks).map(n => Number(n));
  addrs.sort((a, b) => a - b);
  return addrs.map(addr => ({ addr, c: snap.chunks[addr] }));
}

function collectTotalSpan(snap: ArenaSnapshot) {
  const items = orderedChunks(snap);
  if (items.length === 0) return { start: 0, end: 0, bytes: 0 };
  const start = items[0].addr >>> 0;
  const top = snap.top ?? items[items.length - 1].addr;
  const topSize = maskSize(snap.chunks[top]?.size) + CHUNK_OVERHEAD;
  const end = ((top >>> 0) + topSize) >>> 0;
  return { start, end, bytes: end - start };
}

export default function MemoryBar({ snap }: { snap: ArenaSnapshot }) {
  const { start, bytes } = useMemo(() => collectTotalSpan(snap), [snap]);
  const items = useMemo(() => orderedChunks(snap), [snap]);

  if (bytes <= 0 || items.length === 0) {
    return (
      <div className="w-full mb-2 h-6 bg-gray-200 border border-gray-300 grid place-items-center text-[11px] text-gray-500">
        (no chunks)
      </div>
    );
  }

  return (
    <div className="w-full mb-2">
      <div className="mb-1 flex items-center justify-between text-[11px] text-gray-600">
        <span>heap layout</span>
        <span className="flex gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 bg-emerald-300 border border-emerald-600" /> inuse
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 bg-sky-200 border border-sky-500" /> free
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 bg-amber-200 border border-amber-600" /> top
          </span>
        </span>
      </div>

      <div className="w-full h-6 border border-gray-400 overflow-hidden flex">
        {items.map(({ addr, c }) => {
          const raw = maskSize(c.size) + CHUNK_OVERHEAD;
          const widthPct = Math.max((raw / bytes) * 100, 0.2);
          const isTop = (snap.top ?? -1) === addr;
          const cls =
            'h-full shrink-0 border-r ' +
            (isTop
              ? ' bg-amber-200 border-amber-600'
              : c.inuse
                ? ' bg-emerald-300 border-emerald-600'
                : ' bg-sky-200 border-sky-500');

          const tooltip =
            `chunk ${hex(addr)}\n` +
            `ptr   ${hex((addr + CHUNK_OVERHEAD) >>> 0)}\n` +
            `size  ${hex(maskSize(c.size))} (+hdr ${CHUNK_OVERHEAD})\n` +
            `state ${isTop ? 'TOP' : c.inuse ? 'INUSE' : 'FREE'}`;

          return (
            <div key={addr} className={cls} style={{ width: `${widthPct}%` }} title={tooltip} />
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-gray-500">
        <span>{hex(start)}</span>
        <span>{hex((start + bytes) >>> 0)}</span>
      </div>
    </div>
  );
}
