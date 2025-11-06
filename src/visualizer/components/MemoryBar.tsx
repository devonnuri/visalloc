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

export default function MemoryBar({
  snap,
  selectedPtr,
  onSelect,
}: {
  snap: ArenaSnapshot;
  selectedPtr?: number | null;
  onSelect?: (ptr: number) => void;
}) {
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
          const ptr = ((addr + CHUNK_OVERHEAD) >>> 0) as number;
          const isSelected = selectedPtr != null && ptr === selectedPtr;
          const cls =
            'h-full shrink-0 border-r ' +
            (isTop
              ? isSelected
                ? ' bg-amber-300 border-amber-700 ring-2 ring-inset ring-black/20'
                : ' bg-amber-200 border-amber-600'
              : c.inuse
                ? isSelected
                  ? ' bg-emerald-500 border-emerald-700 ring-2 ring-inset ring-black/20'
                  : ' bg-emerald-300 border-emerald-600'
                : isSelected
                  ? ' bg-sky-400 border-sky-700 ring-2 ring-inset ring-black/20'
                  : ' bg-sky-200 border-sky-500');

          const tooltip =
            `chunk ${hex(addr)}\n` +
            `ptr   ${hex(ptr)}\n` +
            `size  ${hex(maskSize(c.size))} (+hdr ${CHUNK_OVERHEAD})\n` +
            `state ${isTop ? 'TOP' : c.inuse ? 'INUSE' : 'FREE'}`;

          const clickable = typeof onSelect === 'function';
          const finalCls = cls + (clickable ? ' cursor-pointer' : '');
          return (
            <div
              key={addr}
              className={finalCls}
              style={{ width: `${widthPct}%` }}
              title={tooltip}
              onClick={() => clickable && onSelect!(ptr)}
            />
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
