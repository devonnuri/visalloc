import React, { useMemo, useRef, useState, useEffect } from 'react';
import type { Addr, ArenaSnapshot } from './ptmalloc2';
import { Arena as ArenaImpl, CHUNK_OVERHEAD } from './ptmalloc2';

// -------------------------- Presentational Bits --------------------------
function FlagCell({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={
        'w-6 h-6 border rounded-md grid place-items-center text-xs font-mono ' +
        (active ? ' border-emerald-600 text-emerald-700 bg-emerald-50 ' : ' border-gray-500 ')
      }
      title={label}
    >
      {label}
    </div>
  );
}

function hex(n?: number | null) {
  if (n == null) return '-';
  return '0x' + (n >>> 0).toString(16);
}

function parsePtr(input: string): number | null {
  if (!input) return null;
  const s = input.trim();
  if (/^0x/i.test(s)) {
    const v = Number.parseInt(s, 16);
    return Number.isFinite(v) ? v : null;
  }
  const v = Number.parseInt(s, 10);
  return Number.isFinite(v) ? v : null;
}

function ChunkCard({
  caddr,
  c,
  isTop = false,
}: {
  caddr: number;
  c: ArenaSnapshot['chunks'][number];
  isTop?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-600 bg-gray-100 shadow-sm overflow-hidden flex flex-col font-mono w-56">
      {/* Row: prev_size */}
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <span className="font-medium">prev_size</span>
        <span>{hex(c.prev_size)}</span>
      </div>

      {/* Row: size + flags */}
      <div className="flex items-stretch border-t border-gray-300 px-3 py-2 text-xs">
        <div className="flex flex-col">
          <span className="font-medium">size</span>
          <span>{hex(c.size)}</span>
        </div>
        <div className="flex-1 flex items-center justify-end gap-1 ml-4">
          <FlagCell label="A" active={!!c.inuse} />
          <FlagCell label="P" active={!!c.prev_inuse} />
          <FlagCell label="T" active={isTop} />
        </div>
      </div>

      {/* Row: fd / bk */}
      <div className="flex items-center border-t border-gray-300 px-3 py-2 text-xs font-mono">
        <div className="flex-1">{'fd: ' + hex(c.fd as number | null)}</div>
        <div className="flex-1">{'bk: ' + hex(c.bk as number | null)}</div>
      </div>

      {/* Bottom area: address + ptr */}
      <div className="bg-gray-200 text-gray-700 px-3 py-2 border-t border-gray-300 text-xs space-y-0.5">
        <div>{'chunk ' + hex(caddr)}</div>
        <div>{'ptr ' + hex((caddr + CHUNK_OVERHEAD) >>> 0)}</div>
      </div>
    </div>
  );
}

function BinRow({
  items,
  snap,
  labelTopPredicate,
}: {
  items: number[]; // chunk header addresses
  snap: ArenaSnapshot;
  labelTopPredicate?: (addr: number) => boolean;
}) {
  return (
    <div className="flex gap-4 flex-nowrap overflow-x-auto py-2">
      {items.length === 0 ? (
        <div className="text-gray-500 text-xs italic">(empty)</div>
      ) : (
        items.map(addr => (
          <div key={addr} className="shrink-0">
            <ChunkCard
              caddr={addr}
              c={snap.chunks[addr]}
              isTop={labelTopPredicate?.(addr) ?? false}
            />
          </div>
        ))
      )}
    </div>
  );
}

function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-300 p-5 bg-white font-mono">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-gray-800 font-semibold text-sm">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// -------------------------- Arena Helpers --------------------------
function traverseCircular(head: number | null, snap: ArenaSnapshot): number[] {
  if (head == null) return [];
  const out: number[] = [];
  let cur = head;
  const guard = new Set<number>();
  while (!guard.has(cur)) {
    guard.add(cur);
    out.push(cur);
    const next = snap.chunks[cur]?.fd as number | null;
    if (next == null) break;
    cur = next;
  }
  return out;
}

function listFastbin(i: number, snap: ArenaSnapshot): number[] {
  const head = snap.fastbins[i];
  const out: number[] = [];
  let cur = head;
  const guard = new Set<number>();
  while (cur != null && !guard.has(cur)) {
    guard.add(cur);
    out.push(cur);
    const next = (snap.chunks[cur]?.fd as number | null) ?? null;
    cur = next;
  }
  return out;
}

function listSmallbin(i: number, snap: ArenaSnapshot): number[] {
  const head = snap.smallbins[i];
  return traverseCircular(head, snap);
}

function listLargebin(i: number, snap: ArenaSnapshot): number[] {
  const head = snap.largebins[i];
  return traverseCircular(head, snap); // iterate address ring (fd)
}

// -------------------------- Main UI --------------------------
export default function Visualizer() {
  const arenaRef = useRef<InstanceType<typeof ArenaImpl> | null>(null);
  const [snap, setSnap] = useState<ArenaSnapshot | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [size, setSize] = useState<string>('24');
  const [ptrs, setPtrs] = useState<number[]>([]); // allocation stack (LIFO free)
  const [freePtr, setFreePtr] = useState<string>('');
  const [showAllSmall, setShowAllSmall] = useState(false);
  const [showAllLarge, setShowAllLarge] = useState(false);

  // One-time init
  useEffect(() => {
    if (arenaRef.current == null) {
      arenaRef.current = new ArenaImpl(1 << 15);
      setSnap(arenaRef.current.snapshot());
      setEvents([...(arenaRef.current as ArenaImpl).events]);
    }
  }, []);

  // Keep freePtr defaulting to the latest allocated pointer if empty
  useEffect(() => {
    if (ptrs.length && !freePtr) {
      setFreePtr(hex(ptrs[ptrs.length - 1]));
    }
  }, [ptrs, freePtr]);

  const topAddr = snap?.top ?? null;
  const topChunk = React.useMemo(
    () => (snap && topAddr != null ? snap.chunks[topAddr] : null),
    [snap, topAddr]
  );

  const unsortedItems = useMemo(() => (snap ? traverseCircular(snap.unsorted, snap) : []), [snap]);

  const nonEmptyFastbinIndices = useMemo(() => {
    if (!snap) return [] as number[];
    const acc: number[] = [];
    for (let i = 0; i < snap.fastbins.length; i++) {
      if (snap.fastbins[i] != null) acc.push(i);
    }
    return acc;
  }, [snap]);

  const smallbinIndices = useMemo(() => {
    if (!snap) return [] as number[];
    const idxs: number[] = [];
    for (let i = 0; i < snap.smallbins.length; i++) {
      if (snap.smallbins[i] != null) idxs.push(i);
    }
    return showAllSmall
      ? Array.from({ length: snap.smallbins.length }, (_, i) => i)
      : idxs.slice(0, 8);
  }, [snap, showAllSmall]);

  const largebinIndices = useMemo(() => {
    if (!snap) return [] as number[];
    const idxs: number[] = [];
    for (let i = 0; i < snap.largebins.length; i++) {
      if (snap.largebins[i] != null) idxs.push(i);
    }
    return showAllLarge
      ? Array.from({ length: snap.largebins.length }, (_, i) => i)
      : idxs.slice(0, 8);
  }, [snap, showAllLarge]);

  function refresh() {
    const s = arenaRef.current!.snapshot();
    setSnap(s);
    setEvents([...(arenaRef.current as ArenaImpl).events]);
  }

  function doMalloc() {
    const n = parseInt(size || '0', 10);
    if (!Number.isFinite(n) || n <= 0 || !arenaRef.current) return;
    const p = arenaRef.current.malloc(n);
    refresh();
    if (p) {
      setPtrs(prev => [...prev, p as number]);
      setFreePtr(hex(p as number));
    }
  }

  function doConsolidate() {
    if (!arenaRef.current) return;
    arenaRef.current.mallocConsolidate();
    refresh();
  }

  function doFreeLast() {
    if (!arenaRef.current || ptrs.length === 0) return;
    const p = ptrs[ptrs.length - 1];
    arenaRef.current.free(p as number);
    refresh();
    setPtrs(prev => prev.slice(0, -1));
  }

  function doFreePtr() {
    if (!arenaRef.current || !freePtr) return;
    const p = parsePtr(freePtr);
    if (p == null) return;
    arenaRef.current.free(p);
    refresh();
    // also remove from stack if present
    setPtrs(prev => prev.filter(q => q !== p));
  }

  // Helper: render allocated stack
  const allocatedCards = useMemo(() => {
    if (!snap) return [] as JSX.Element[];
    return ptrs.slice(-6).map(p => {
      const ch = arenaRef.current?.getChunk(p as number);
      if (!ch)
        return <div key={p} className="text-xs text-gray-500">{`ptr ${hex(p)} (not found)`}</div>;
      const cSnap = snap.chunks[ch.addr];
      return (
        <div key={p} className="shrink-0">
          <ChunkCard caddr={ch.addr} c={cSnap} isTop={ch.addr === topAddr} />
        </div>
      );
    });
  }, [ptrs, snap, topAddr]);

  return (
    <div className="w-full min-h-screen bg-neutral-50 text-gray-900 p-6 font-mono">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          placeholder="size"
          value={size}
          onChange={e => setSize(e.target.value)}
          className="h-8 w-28 rounded-md border border-gray-400 bg-white px-2 text-sm font-mono"
        />
        <button
          onClick={doMalloc}
          className="h-8 px-3 rounded-md border border-gray-600 bg-gray-200 text-sm shadow font-mono"
        >
          malloc
        </button>
        <button
          onClick={doFreeLast}
          className="h-8 px-3 rounded-md border border-gray-600 bg-gray-200 text-sm shadow font-mono"
        >
          free (last)
        </button>
        <div className="flex items-center gap-2">
          <input
            placeholder="free(ptr) e.g. 0x1010"
            value={freePtr}
            onChange={e => setFreePtr(e.target.value)}
            className="h-8 w-44 rounded-md border border-gray-400 bg-white px-2 text-sm font-mono"
          />
          <button
            onClick={doFreePtr}
            className="h-8 px-3 rounded-md border border-gray-600 bg-gray-200 text-sm shadow font-mono"
          >
            free(ptr)
          </button>
        </div>
        <button
          onClick={doConsolidate}
          className="h-8 px-3 rounded-md border border-gray-600 bg-gray-200 text-sm shadow font-mono"
        >
          consolidate
        </button>
        <div className="ml-auto text-xs text-gray-600 flex items-center gap-4">
          <span>top: {hex(topAddr)}</span>
          <span>next free: {ptrs.length ? hex(ptrs[ptrs.length - 1]) : '-'}</span>
        </div>
      </div>

      <Section title="top chunk (wilderness)">
        {topChunk ? (
          <div className="flex gap-4 items-start">
            <ChunkCard caddr={topAddr as number} c={topChunk} isTop />
            <div className="text-xs text-gray-600 leading-5 max-w-md">
              <div>
                <span className="font-semibold">Address:</span> {hex(topAddr as number)}
              </div>
              <div>
                <span className="font-semibold">Size:</span> {hex(topChunk.size as number)}
              </div>
              <div className="mt-1">
                The <em>top chunk</em> (a.k.a. wilderness) is not in any bin. Allocations split from
                its head; frees that coalesce to the top will merge here.
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-gray-500 italic">(no top chunk)</div>
        )}
      </Section>

      {snap && (
        <div className="space-y-8">
          <Section title="unsorted bin">
            <BinRow items={unsortedItems} snap={snap} labelTopPredicate={a => a === topAddr} />
          </Section>

          <Section
            title="fastbins"
            right={<span className="text-xs text-gray-500">non-empty only</span>}
          >
            {nonEmptyFastbinIndices.length === 0 ? (
              <div className="text-xs text-gray-500 italic">(all empty)</div>
            ) : (
              <div className="space-y-4">
                {nonEmptyFastbinIndices.map(i => (
                  <div key={i}>
                    <div className="text-xs font-semibold text-gray-700 mb-1">fastbin[{i}]</div>
                    <BinRow
                      items={listFastbin(i, snap)}
                      snap={snap}
                      labelTopPredicate={a => a === topAddr}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="smallbins"
            right={
              <button
                onClick={() => setShowAllSmall(v => !v)}
                className="h-7 px-2 rounded-md border border-gray-400 bg-gray-100 text-xs"
              >
                {showAllSmall ? 'show non-empty' : 'show all (first 64)'}
              </button>
            }
          >
            {smallbinIndices.length === 0 ? (
              <div className="text-xs text-gray-500 italic">(no non-empty smallbins)</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {smallbinIndices.map(i => (
                  <div key={i}>
                    <div className="text-xs font-semibold text-gray-700 mb-1">smallbin[{i}]</div>
                    <BinRow
                      items={listSmallbin(i, snap)}
                      snap={snap}
                      labelTopPredicate={a => a === topAddr}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="largebins"
            right={
              <button
                onClick={() => setShowAllLarge(v => !v)}
                className="h-7 px-2 rounded-md border border-gray-400 bg-gray-100 text-xs"
              >
                {showAllLarge ? 'show non-empty' : 'show all (bucketed)'}
              </button>
            }
          >
            {largebinIndices.length === 0 ? (
              <div className="text-xs text-gray-500 italic">(no non-empty largebins)</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {largebinIndices.map(i => (
                  <div key={i}>
                    <div className="text-xs font-semibold text-gray-700 mb-1">largebin[{i}]</div>
                    <BinRow
                      items={listLargebin(i, snap)}
                      snap={snap}
                      labelTopPredicate={a => a === topAddr}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="tcache (size → LIFO stack)">
            {Object.keys(snap.tcache).length === 0 ? (
              <div className="text-xs text-gray-500 italic">(tcache empty)</div>
            ) : (
              <div className="space-y-4">
                {Object.keys(snap.tcache)
                  .map(k => Number(k))
                  .sort((a, b) => a - b)
                  .map(nb => (
                    <div key={nb}>
                      <div className="text-xs font-semibold text-gray-700 mb-1">size {hex(nb)}</div>
                      <BinRow
                        items={snap.tcache[nb]}
                        snap={snap}
                        labelTopPredicate={a => a === topAddr}
                      />
                    </div>
                  ))}
              </div>
            )}
          </Section>

          <Section title="allocated (stack top = next free)">
            <div className="flex gap-4 overflow-x-auto py-2">
              {allocatedCards.length ? (
                allocatedCards
              ) : (
                <div className="text-gray-500 text-xs italic">(no allocations yet)</div>
              )}
            </div>
          </Section>

          <Section title="recent events">
            <div className="text-xs text-gray-700 max-h-56 overflow-auto space-y-1">
              {events.slice(-16).map((ev, i) => (
                <div key={i} className="font-mono">
                  <span className="text-gray-500">[{i}]</span> {ev.type} — {ev.msg}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
