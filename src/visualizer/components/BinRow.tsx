import type { ArenaSnapshot } from '../../ptmalloc2';
import ChunkCard from './ChunkCard';

export default function BinRow({
  items,
  snap,
  labelTopPredicate,
  onSelect,
}: {
  items: number[]; // chunk header addresses
  snap: ArenaSnapshot;
  labelTopPredicate?: (addr: number) => boolean;
  onSelect?: (ptr: number) => void;
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
              onSelect={onSelect}
            />
          </div>
        ))
      )}
    </div>
  );
}
