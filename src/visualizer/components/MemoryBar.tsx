import { useMemo, useState, useRef, useEffect } from 'react';
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
  const [zoom, setZoom] = useState<number>(1);
  const ZOOM_STEP = 1.25;
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 10;
  const items = useMemo(() => orderedChunks(snap), [snap]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleStart, setVisibleStart] = useState<number>(start >>> 0);
  const [visibleEnd, setVisibleEnd] = useState<number>((start + bytes) >>> 0);

  function updateVisibleEnd() {
    const el = containerRef.current;
    if (!el) return;
    // content width in px is clientWidth * zoom (since we scale widths by zoom)
    const clientW = el.clientWidth || 1;
    const scrollLeft = el.scrollLeft || 0;
    const contentW = Math.max(1, clientW * zoom);
    const startFraction = Math.min(1, Math.max(0, scrollLeft / contentW));
    const endFraction = Math.min(1, (scrollLeft + clientW) / contentW);
    const visStartBytes = Math.max(0, Math.round(bytes * startFraction));
    const visEndBytes = Math.max(0, Math.round(bytes * endFraction));
    const startAddr = ((start + visStartBytes) >>> 0) as number;
    const endAddr = ((start + visEndBytes) >>> 0) as number;
    setVisibleStart(startAddr);
    setVisibleEnd(endAddr);
  }

  useEffect(() => {
    // Recompute when start/bytes/zoom change
    updateVisibleEnd();
    function onResize() {
      updateVisibleEnd();
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [start, bytes, zoom]);

  // Auto-center the selected chunk only when zoom changes (not when selection changes)
  const selectedPtrRef = useRef<number | null | undefined>(null);
  useEffect(() => {
    selectedPtrRef.current = selectedPtr;
  }, [selectedPtr]);

  useEffect(() => {
    console.log(zoom);
    const ptr = selectedPtrRef.current;
    if (ptr == null) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-ptr="${ptr}"]`) as HTMLElement | null;
    if (!el) return;
    const target = Math.max(0, el.offsetLeft + el.offsetWidth / 2 - container.clientWidth / 2);
    container.scrollTo({ left: target, behavior: 'smooth' });
    // ensure visible range updates after scroll finishes (give it a moment)
    const t = setTimeout(() => updateVisibleEnd(), 220);
    return () => clearTimeout(t);
  }, [zoom]);

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
        <div className="flex items-center gap-3">
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

        <div className="flex items-center gap-2">
          <button
            title="zoom out"
            onClick={() => setZoom(z => Math.max(ZOOM_MIN, +(z / ZOOM_STEP).toFixed(3)))}
            className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 bg-white text-sm"
          >
            –
          </button>
          <div className="text-xs text-gray-600 w-12 text-center">{Math.round(zoom * 100)}%</div>
          <button
            title="zoom in"
            onClick={() => setZoom(z => Math.min(ZOOM_MAX, +(z * ZOOM_STEP).toFixed(3)))}
            className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 bg-white text-sm"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={() => updateVisibleEnd()}
        className="w-full h-6 border border-gray-400 overflow-x-auto flex"
      >
        {items.map(({ addr, c }) => {
          const raw = maskSize(c.size) + CHUNK_OVERHEAD;
          const widthPct = Math.max((raw / bytes) * 100, 0.2) * zoom;
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
              data-ptr={ptr}
              data-addr={addr}
              className={finalCls}
              style={{ width: `${widthPct}%`, transition: 'width 220ms ease' }}
              title={tooltip}
              onClick={() => clickable && onSelect!(ptr)}
            />
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-gray-500">
        <span>{hex(visibleStart >>> 0)}</span>
        <span>{hex(visibleEnd >>> 0)}</span>
      </div>
    </div>
  );
}
