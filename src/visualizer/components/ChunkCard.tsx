import FlagCell from './FlagCell';
import type { ArenaSnapshot } from '../../ptmalloc2';
import { CHUNK_OVERHEAD } from '../../ptmalloc2';
import { hex } from '../utils';

export default function ChunkCard({
  caddr,
  c,
  isTop = false,
  selected = false,
  onSelect,
}: {
  caddr: number;
  c: ArenaSnapshot['chunks'][number];
  isTop?: boolean;
  selected?: boolean;
  onSelect?: (ptr: number) => void;
}) {
  return (
    <div className="flex flex-col">
      <div>
        <div
          className={(() => {
            const base = 'text-xs text-gray-800 px-1 inline-block';
            const cls = isTop
              ? selected
                ? ' bg-amber-300 border-amber-700'
                : ' bg-amber-200 border-amber-600'
              : c.inuse
                ? selected
                  ? ' bg-emerald-400 border-emerald-700'
                  : ' bg-emerald-200 border-emerald-600'
                : selected
                  ? ' bg-sky-300 border-sky-700'
                  : ' bg-sky-200 border-sky-600';
            return base + cls;
          })()}
        >
          {`${hex(caddr)} (ptr ${hex((caddr + CHUNK_OVERHEAD) >>> 0)})`}
        </div>
      </div>
      <div
        onClick={() => onSelect && onSelect(((caddr + CHUNK_OVERHEAD) >>> 0) as number)}
        // color the card like MemoryBar. We'll compute classes below.
        className={(() => {
          // use the passed-in selected prop
          const base =
            'shadow-sm overflow-hidden flex flex-col font-mono w-56 cursor-pointer border bg-gray-100 border-gray-500';
          const cls = selected ? ' ring-2 ring-inset ring-black/20' : '';
          return base + cls;
        })()}
      >
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
        {/* <div className="bg-gray-200 text-gray-700 px-3 py-2 border-t border-gray-300 text-xs space-y-0.5">
        <div>{'chunk ' + hex(caddr)}</div>
        <div>{'ptr ' + hex((caddr + CHUNK_OVERHEAD) >>> 0)}</div>
      </div> */}
      </div>
    </div>
  );
}
