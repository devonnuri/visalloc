import type { ArenaSnapshot } from '../../ptmalloc2';
import { CHUNK_OVERHEAD } from '../../ptmalloc2';
import ChunkCard from './ChunkCard';

export default function BinRow({
  items,
  snap,
  labelTopPredicate,
  onSelect,
  selectedPtr,
}: {
  items: number[]; // chunk header addresses
  snap: ArenaSnapshot;
  labelTopPredicate?: (addr: number) => boolean;
  onSelect?: (ptr: number) => void;
  selectedPtr?: number | null;
}) {
  if (items.length === 0) {
    return <div className="text-gray-500 text-xs italic">(empty)</div>;
  }
  return (
    <div className="flex gap-4 flex-nowrap overflow-x-auto py-2">
      {items.map(addr => {
        const ptr = ((addr + CHUNK_OVERHEAD) >>> 0) as number;
        const isSelected = selectedPtr != null && selectedPtr === ptr;
        return (
          <div key={addr} className="shrink-0">
            <ChunkCard
              caddr={addr}
              c={snap.chunks[addr]}
              isTop={labelTopPredicate?.(addr) ?? false}
              selected={isSelected}
              onSelect={onSelect}
            />
          </div>
        );
      })}
    </div>
  );
}
