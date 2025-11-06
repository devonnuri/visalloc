/*
 * ptmalloc2.ts — educational TypeScript re-implementation (simulator)
 * ----------------------------------------------------------------------------
 * Goal: provide a readable, instrumented simulator of glibc ptmalloc2 concepts
 * (chunks, bins, fastbins, unsorted bin, small/large bins, top chunk, tcache),
 * suitable for a web visualizer. This is NOT a drop-in allocator; it's a model
 * for teaching/visualization/testing.
 *
 * Design choices:
 * - 64-bit style sizes and 16-byte alignment.
 * - Single arena (no threads), but structure allows future arenas.
 * - Memory is an address→Chunk map; addresses are monotonically increasing.
 * - Doubly-linked bin lists use addresses + {fd,bk} pointers like glibc.
 * - Large bin ordering is kept sorted by size; small bins are FIFO.
 * - Fastbins are singly-linked (LIFO) and consolidated lazily.
 * - TCache modeled as per-size arrays with a small capacity.
 * - Extensive event logging for UI step-by-step visualization.
 *
 * Limitations vs real ptmalloc2:
 * - No mmap; sysmalloc just extends the top chunk (sbrk-like growth).
 * - Security hardening (safe-linking, checksums) omitted by default; optional.
 * - No multi-arena, no per-thread tcache (just one tcache here).
 * - Many size constants approximate common glibc configs.
 */

// ----------------------------------------------------------------------------
// Types & helpers
// ----------------------------------------------------------------------------

export type Addr = number; // abstract address (monotonic)

export const SIZE_SZ = 8; // simulate 64-bit
export const MALLOC_ALIGNMENT = 16;
export const CHUNK_OVERHEAD = 2 * SIZE_SZ; // prev_size + size field
export const MIN_CHUNK_SIZE = 2 * SIZE_SZ; // header-only minimal chunk (no payload)

// Conservative defaults inspired by glibc (approximate)
export const FASTBIN_MAX = 80; // max request size handled by fastbins (bytes)
export const NBINS_SMALL = 64; // small bins for sizes up to 512 (approx)
export const SMALLBIN_MAX = 512; // last smallbin request size (approx)
export const TCACHE_MAX = 64; // max entries per distinct size class
export const TCACHE_BIN_LIMIT = 7; // max chunks per size class in tcache
export const FASTBIN_CONSOLIDATION_THRESHOLD = 8192; // trigger consolidate if top small

export function alignUp(n: number, a = MALLOC_ALIGNMENT): number {
  return (n + (a - 1)) & ~(a - 1);
}

export function request2size(req: number): number {
  const sz = alignUp(req + CHUNK_OVERHEAD);
  return Math.max(sz, MIN_CHUNK_SIZE);
}

export function chunk2mem(addr: Addr): Addr {
  return addr + CHUNK_OVERHEAD;
}

export function mem2chunk(mem: Addr): Addr {
  return mem - CHUNK_OVERHEAD;
}

export interface Chunk {
  addr: Addr; // starting address of chunk header
  prev_size: number; // size of previous chunk if it is free
  size: number; // size including header + inuse flags in LSBs (simulated)
  inuse: boolean; // current allocation state
  prev_inuse: boolean; // whether previous chunk is in use
  // bin links (addresses). For fastbins: only fd is used.
  fd?: Addr | null;
  bk?: Addr | null;
  // largebin secondary order links (by size)
  fd_nextsize?: Addr | null;
  bk_nextsize?: Addr | null;
}

export interface EventBase {
  type: string;
  msg: string;
  state?: Partial<ArenaSnapshot>;
}

export type AllocEvent =
  | { type: 'sysmalloc'; bytes: number; oldTop: Addr; newTop: Addr; msg: string }
  | { type: 'malloc'; bytes: number; nb: number; result: Addr | null; source: string; msg: string }
  | { type: 'free'; ptr: Addr; size: number; into: string; msg: string }
  | { type: 'consolidate'; msg: string }
  | { type: 'tcache-put'; size: number; msg: string }
  | { type: 'tcache-get'; size: number; msg: string }
  | { type: 'bin-insert'; bin: string; addr: Addr; size: number; msg: string }
  | { type: 'bin-unlink'; bin: string; addr: Addr; size: number; msg: string }
  | { type: 'split'; from: Addr; into: [Addr, Addr]; sizes: [number, number]; msg: string }
  | { type: 'coalesce'; result: Addr; size: number; parts: Addr[]; msg: string }
  | { type: 'error'; msg: string };

export interface ArenaSnapshot {
  top: Addr;
  topSize: number;
  fastbins: (Addr | null)[]; // heads of singly-linked lists
  unsorted: Addr | null; // head of doubly-linked list (circular when non-empty)
  smallbins: (Addr | null)[];
  largebins: (Addr | null)[];
  tcache: Record<number, Addr[]>; // size->array of chunk addresses
  chunks: Record<
    number,
    {
      size: number;
      prev_size: number;
      inuse: boolean;
      prev_inuse: boolean;
      fd?: Addr | null;
      bk?: Addr | null;
      fd_nextsize?: Addr | null;
      bk_nextsize?: Addr | null;
    }
  >;
}

// ----------------------------------------------------------------------------
// Arena & bins
// ----------------------------------------------------------------------------

export class Arena {
  // heap model: address→Chunk, monotonically growing addresses
  private mem = new Map<Addr, Chunk>();
  private nextAddr: Addr = 0x1000; // arbitrary base

  // top chunk (wilderness)
  public top: Addr = 0 as Addr; // address of top chunk header

  // bins
  private fastbins: (Addr | null)[] = new Array(10).fill(null);
  private unsorted: Addr | null = null;
  private smallbins: (Addr | null)[] = new Array(NBINS_SMALL).fill(null);
  private largebins: (Addr | null)[] = new Array(32).fill(null); // coarse buckets

  // simple tcache: size → stack of addrs
  private tcache = new Map<number, Addr[]>();

  // event log
  public events: AllocEvent[] = [];

  constructor(initialHeapBytes = 1 << 16) {
    // create initial top chunk covering initialHeapBytes
    const size = alignUp(initialHeapBytes);
    const topChunk: Chunk = {
      addr: this.nextAddr,
      prev_size: 0,
      size: size,
      inuse: false,
      prev_inuse: true,
      fd: null,
      bk: null,
      fd_nextsize: null,
      bk_nextsize: null,
    };
    this.mem.set(topChunk.addr, topChunk);
    this.top = topChunk.addr;
    this.nextAddr += size;
  }

  // ------------------------------ Snapshots ------------------------------
  snapshot(): ArenaSnapshot {
    const chunks: ArenaSnapshot['chunks'] = {};
    for (const [addr, c] of this.mem.entries()) {
      chunks[addr] = {
        size: c.size,
        prev_size: c.prev_size,
        inuse: c.inuse,
        prev_inuse: c.prev_inuse,
        fd: c.fd ?? null,
        bk: c.bk ?? null,
        fd_nextsize: c.fd_nextsize ?? null,
        bk_nextsize: c.bk_nextsize ?? null,
      };
    }
    const tcacheObj: Record<number, Addr[]> = {};
    for (const [k, v] of this.tcache.entries()) tcacheObj[k] = [...v];
    const topChunk = this.mem.get(this.top)!;
    return {
      top: this.top,
      topSize: topChunk.size,
      fastbins: [...this.fastbins],
      unsorted: this.unsorted,
      smallbins: [...this.smallbins],
      largebins: [...this.largebins],
      tcache: tcacheObj,
      chunks,
    };
  }

  private log(ev: AllocEvent) {
    this.events.push(ev);
  }

  // ------------------------------ Indexing ------------------------------
  private fastbinIndex(sz: number): number {
    // For 16-aligned sizes: indices for 32,48,64,80,96,... but we cap at FASTBIN_MAX
    const maxReq = FASTBIN_MAX;
    if (sz > request2size(maxReq)) return -1;
    // Convert chunk size to index: ((sz)/MALLOC_ALIGNMENT) - offset
    // We want first index to represent smallest eligible size (here 32B chunk)
    const firstSize = request2size(16); // 16B payload => 32B chunk
    const idx = (sz - firstSize) / MALLOC_ALIGNMENT;
    if (idx < 0 || idx >= this.fastbins.length) return -1;
    return idx | 0;
  }

  private smallbinIndex(sz: number): number {
    // Map chunk size (<= SMALLBIN_MAX) to [0, NBINS_SMALL)
    if (sz > request2size(SMALLBIN_MAX)) return -1;
    const firstSize = request2size(16);
    const idx = (sz - firstSize) / MALLOC_ALIGNMENT;
    if (idx < 0) return -1;
    return Math.min(idx | 0, NBINS_SMALL - 1);
  }

  private largebinIndex(sz: number): number {
    // Coarse log2 buckets; not glibc-accurate but fine for viz
    let b = 0;
    let x = sz >>> 0;
    while ((x >>= 1)) b++;
    return Math.min(b, this.largebins.length - 1);
  }

  // ------------------------------ Memory helpers ------------------------------
  private chunkAt(addr: Addr): Chunk | undefined {
    return this.mem.get(addr);
  }

  private nextChunk(c: Chunk): Chunk | undefined {
    const nextAddr = (c.addr + c.size) as Addr;
    return this.mem.get(nextAddr);
  }

  private prevChunk(c: Chunk): Chunk | undefined {
    if (!c.prev_inuse && c.prev_size > 0) {
      const prevAddr = (c.addr - c.prev_size) as Addr;
      return this.mem.get(prevAddr);
    }
    return undefined;
  }

  private makeChunk(size: number, prev_inuse: boolean, prev_size: number): Chunk {
    const addr = this.nextAddr as Addr;
    const c: Chunk = {
      addr,
      size,
      prev_size,
      inuse: false,
      prev_inuse,
      fd: null,
      bk: null,
      fd_nextsize: null,
      bk_nextsize: null,
    };
    this.mem.set(addr, c);
    this.nextAddr += size;
    return c;
  }

  private sysmalloc(nb: number): Chunk {
    // extend top by at least nb
    const grow = alignUp(Math.max(nb, 1 << 16));
    const top = this.mem.get(this.top)!;
    // "extend" the top by creating an adjacent free chunk and merging
    const ext = this.makeChunk(grow, true, top.size);
    // coalesce top + ext into new top
    top.size += ext.size;
    this.mem.delete(ext.addr);
    this.log({
      type: 'sysmalloc',
      bytes: grow,
      oldTop: top.addr,
      newTop: top.addr,
      msg: `sysmalloc: extended top by ${grow}B`,
    });
    return top;
  }

  // ------------------------------ Bin ops ------------------------------
  private unlinkSmallOrUnsorted(addr: Addr) {
    const c = this.mem.get(addr)!;
    const fd = c.fd!;
    const bk = c.bk!;
    this.mem.get(fd)!.bk = bk;
    this.mem.get(bk)!.fd = fd;
    c.fd = c.bk = null;
  }

  private insertUnsorted(c: Chunk) {
    // Use circular doubly-linked list with head sentinel stored in this.unsorted as first elem
    if (this.unsorted == null) {
      // create singleton circular
      c.fd = c.addr;
      c.bk = c.addr;
      this.unsorted = c.addr;
    } else {
      const head = this.mem.get(this.unsorted)!;
      const tail = this.mem.get(head.bk!)!;
      c.fd = head.addr;
      c.bk = tail.addr;
      head.bk = c.addr;
      tail.fd = c.addr;
    }
    this.log({
      type: 'bin-insert',
      bin: 'unsorted',
      addr: c.addr,
      size: c.size,
      msg: `insert to unsorted: ${c.addr.toString(16)}`,
    });
  }

  private popFromUnsorted(predicate: (c: Chunk) => boolean): Chunk | null {
    let headAddr = this.unsorted;
    if (headAddr == null) return null;
    const head = this.mem.get(headAddr)!;
    let cur: Chunk = head; // iterate once around
    do {
      if (predicate(cur)) {
        const wasSingleton = cur.fd === cur.addr && cur.bk === cur.addr;
        if (wasSingleton) {
          this.unsorted = null;
        } else {
          const fd = this.mem.get(cur.fd!)!;
          const bk = this.mem.get(cur.bk!)!;
          fd.bk = bk.addr;
          bk.fd = fd.addr;
          if (this.unsorted === cur.addr) this.unsorted = fd.addr;
        }
        cur.fd = cur.bk = null;
        this.log({
          type: 'bin-unlink',
          bin: 'unsorted',
          addr: cur.addr,
          size: cur.size,
          msg: 'unlink from unsorted',
        });
        return cur;
      }
      if (cur.fd == null) break;
      cur = this.mem.get(cur.fd)!;
    } while (cur.addr !== headAddr);
    return null;
  }

  private insertSmallbin(c: Chunk) {
    const idx = this.smallbinIndex(c.size);
    if (idx < 0) throw new Error('size not smallbin');
    const headAddr = this.smallbins[idx];
    if (headAddr == null) {
      c.fd = c.addr;
      c.bk = c.addr;
      this.smallbins[idx] = c.addr;
    } else {
      const head = this.mem.get(headAddr)!;
      const tail = this.mem.get(head.bk!)!;
      c.fd = head.addr;
      c.bk = tail.addr;
      head.bk = c.addr;
      tail.fd = c.addr;
    }
    this.log({
      type: 'bin-insert',
      bin: `smallbin[${idx}]`,
      addr: c.addr,
      size: c.size,
      msg: 'insert smallbin',
    });
  }

  private takeFromSmallbin(idx: number, nb: number): Chunk | null {
    const headAddr = this.smallbins[idx];
    if (headAddr == null) return null;
    // FIFO: take head
    const head = this.mem.get(headAddr)!;
    const wasSingleton = head.fd === head.addr && head.bk === head.addr;
    if (wasSingleton) {
      this.smallbins[idx] = null;
    } else {
      const fd = this.mem.get(head.fd!)!;
      const bk = this.mem.get(head.bk!)!;
      fd.bk = bk.addr;
      bk.fd = fd.addr;
      this.smallbins[idx] = fd.addr;
    }
    head.fd = head.bk = null;
    this.log({
      type: 'bin-unlink',
      bin: `smallbin[${idx}]`,
      addr: head.addr,
      size: head.size,
      msg: 'take head',
    });
    return head;
  }

  private insertLargebin(c: Chunk) {
    const idx = this.largebinIndex(c.size);
    let headAddr = this.largebins[idx];
    if (headAddr == null) {
      c.fd = c.addr;
      c.bk = c.addr;
      c.fd_nextsize = c.addr;
      c.bk_nextsize = c.addr;
      this.largebins[idx] = c.addr;
    } else {
      // keep address-circular; also keep a size-sorted secondary ring
      const head = this.mem.get(headAddr)!;
      // insert at end of address ring
      const tail = this.mem.get(head.bk!)!;
      c.fd = head.addr;
      c.bk = tail.addr;
      head.bk = c.addr;
      tail.fd = c.addr;
      // insert into size-sorted ring
      let cur = head;
      do {
        if (c.size <= cur.size) break;
        cur = this.mem.get(cur.fd_nextsize!)!;
      } while (cur.addr !== head.addr);
      const prev = this.mem.get(cur.bk_nextsize!)!;
      c.fd_nextsize = cur.addr;
      c.bk_nextsize = prev.addr;
      prev.fd_nextsize = c.addr;
      cur.bk_nextsize = c.addr;
    }
    this.log({
      type: 'bin-insert',
      bin: `largebin[${idx}]`,
      addr: c.addr,
      size: c.size,
      msg: 'insert largebin',
    });
  }

  private findLargebinFit(nb: number): Chunk | null {
    // search bins from corresponding index upward
    for (let i = this.largebinIndex(nb); i < this.largebins.length; i++) {
      const headAddr = this.largebins[i];
      if (headAddr == null) continue;
      const head = this.mem.get(headAddr)!;
      let cur = head;
      do {
        if (cur.size >= nb) {
          // unlink cur from both rings if singleton/links
          const wasSingletonAddr = cur.fd === cur.addr && cur.bk === cur.addr;
          if (wasSingletonAddr) this.largebins[i] = null;
          else {
            // unlink from addr ring
            const fd = this.mem.get(cur.fd!)!;
            const bk = this.mem.get(cur.bk!)!;
            fd.bk = bk.addr;
            bk.fd = fd.addr;
            if (this.largebins[i] === cur.addr) this.largebins[i] = fd.addr;
            // unlink from size ring
            const fdn = this.mem.get(cur.fd_nextsize!)!;
            const bkn = this.mem.get(cur.bk_nextsize!)!;
            fdn.bk_nextsize = bkn.addr;
            bkn.fd_nextsize = fdn.addr;
          }
          cur.fd = cur.bk = cur.fd_nextsize = cur.bk_nextsize = null;
          this.log({
            type: 'bin-unlink',
            bin: `largebin[${i}]`,
            addr: cur.addr,
            size: cur.size,
            msg: 'take fit',
          });
          return cur;
        }
        cur = this.mem.get(cur.fd_nextsize!)!;
      } while (cur.addr !== headAddr);
    }
    return null;
  }

  private pushFastbin(c: Chunk) {
    const idx = this.fastbinIndex(c.size);
    if (idx < 0) throw new Error('size not fastbin');
    c.fd = this.fastbins[idx];
    this.fastbins[idx] = c.addr;
    this.log({
      type: 'bin-insert',
      bin: `fastbin[${idx}]`,
      addr: c.addr,
      size: c.size,
      msg: 'push fastbin',
    });
  }

  private popFastbinForSize(nb: number): Chunk | null {
    const idx = this.fastbinIndex(nb);
    if (idx < 0) return null;
    const headAddr = this.fastbins[idx];
    if (headAddr == null) return null;
    const c = this.mem.get(headAddr)!;
    this.fastbins[idx] = (c.fd ?? null) as Addr | null;
    c.fd = null;
    this.log({
      type: 'bin-unlink',
      bin: `fastbin[${idx}]`,
      addr: c.addr,
      size: c.size,
      msg: 'pop fastbin',
    });
    return c;
  }

  // ------------------------------ TCache ------------------------------
  private tcacheGet(nb: number): Chunk | null {
    const v = this.tcache.get(nb);
    if (!v || v.length === 0) return null;
    const addr = v.pop()!;
    const c = this.mem.get(addr)!;
    this.log({ type: 'tcache-get', size: nb, msg: `tcache get size ${nb}` });
    return c;
  }

  private tcachePut(c: Chunk) {
    const nb = c.size;
    if (nb > request2size(TCACHE_MAX)) return false;
    const v = this.tcache.get(nb) ?? [];
    if (v.length >= TCACHE_BIN_LIMIT) return false;
    v.push(c.addr);
    this.tcache.set(nb, v);
    this.log({ type: 'tcache-put', size: nb, msg: `tcache put size ${nb}` });
    return true;
  }

  // ------------------------------ Core ops ------------------------------
  malloc(bytes: number): Addr | null {
    const nb = request2size(bytes);

    // 1) Try tcache
    const tc = this.tcacheGet(nb);
    if (tc) {
      tc.inuse = true;
      this.setPrevInuseOnNext(tc, true);
      const ret = chunk2mem(tc.addr);
      this.log({
        type: 'malloc',
        bytes,
        nb,
        result: ret,
        source: 'tcache',
        msg: `malloc(${bytes}) from tcache`,
      });
      return ret;
    }

    // 2) Fastbin single-size exact
    const fb = this.popFastbinForSize(nb);
    if (fb) {
      // fastbin chunks are not consolidated; mark inuse and return
      fb.inuse = true;
      this.setPrevInuseOnNext(fb, true);
      const ret = chunk2mem(fb.addr);
      this.log({
        type: 'malloc',
        bytes,
        nb,
        result: ret,
        source: 'fastbin',
        msg: `malloc(${bytes}) from fastbin`,
      });
      return ret;
    }

    // Maybe consolidate if top below threshold
    const top = this.mem.get(this.top)!;
    if (top.size < FASTBIN_CONSOLIDATION_THRESHOLD) {
      this.mallocConsolidate();
    }

    // 3) Smallbins exact size
    const sidx = this.smallbinIndex(nb);
    if (sidx >= 0) {
      const sb = this.takeFromSmallbin(sidx, nb);
      if (sb) {
        sb.inuse = true;
        this.setPrevInuseOnNext(sb, true);
        const ret = chunk2mem(sb.addr);
        this.log({
          type: 'malloc',
          bytes,
          nb,
          result: ret,
          source: `smallbin[${sidx}]`,
          msg: `malloc(${bytes}) from smallbin`,
        });
        return ret;
      }
    }

    // 4) Unsorted: first-fit, then redirect leftovers to appropriate bins
    let u = this.popFromUnsorted(c => c.size >= nb);
    if (u) {
      const remSize = u.size - nb;
      if (remSize >= MIN_CHUNK_SIZE + MALLOC_ALIGNMENT) {
        // split
        const remainderAddr = (u.addr + nb) as Addr;
        const remainder: Chunk = {
          addr: remainderAddr,
          prev_size: nb,
          size: remSize,
          inuse: false,
          prev_inuse: true,
          fd: null,
          bk: null,
          fd_nextsize: null,
          bk_nextsize: null,
        };
        this.mem.set(remainderAddr, remainder);
        // shrink u
        u.size = nb;
        u.inuse = true;
        this.setPrevInuseOnNext(u, true);
        // fix next chunk's prev info
        const n = this.nextChunk(remainder);
        if (n) {
          n.prev_size = remainder.size;
          n.prev_inuse = false;
        }
        // distribute remainder to small/large bin
        if (this.smallbinIndex(remainder.size) >= 0) this.insertSmallbin(remainder);
        else this.insertLargebin(remainder);
        this.log({
          type: 'split',
          from: u.addr,
          into: [u.addr, remainder.addr],
          sizes: [u.size, remainder.size],
          msg: 'split unsorted fit',
        });
      } else {
        // take whole
        u.inuse = true;
        this.setPrevInuseOnNext(u, true);
      }
      const ret = chunk2mem(u.addr);
      this.log({
        type: 'malloc',
        bytes,
        nb,
        result: ret,
        source: 'unsorted',
        msg: 'malloc from unsorted',
      });
      return ret;
    }

    // 5) Largebins (best-fit-ish)
    const lb = this.findLargebinFit(nb);
    if (lb) {
      const remSize = lb.size - nb;
      if (remSize >= MIN_CHUNK_SIZE + MALLOC_ALIGNMENT) {
        // split
        const remAddr = (lb.addr + nb) as Addr;
        const remainder: Chunk = {
          addr: remAddr,
          prev_size: nb,
          size: remSize,
          inuse: false,
          prev_inuse: true,
          fd: null,
          bk: null,
          fd_nextsize: null,
          bk_nextsize: null,
        };
        this.mem.set(remAddr, remainder);
        // shrink lb
        lb.size = nb;
        lb.inuse = true;
        this.setPrevInuseOnNext(lb, true);
        const n = this.nextChunk(remainder);
        if (n) {
          n.prev_size = remainder.size;
          n.prev_inuse = false;
        }
        // remainder to appropriate bin
        if (this.smallbinIndex(remainder.size) >= 0) this.insertSmallbin(remainder);
        else this.insertLargebin(remainder);
        this.log({
          type: 'split',
          from: lb.addr,
          into: [lb.addr, remainder.addr],
          sizes: [lb.size, remainder.size],
          msg: 'split largebin fit',
        });
      } else {
        lb.inuse = true;
        this.setPrevInuseOnNext(lb, true);
      }
      const ret = chunk2mem(lb.addr);
      this.log({
        type: 'malloc',
        bytes,
        nb,
        result: ret,
        source: 'largebin',
        msg: 'malloc from largebin',
      });
      return ret;
    }

    // 6) Top chunk
    if (top.size < nb) this.sysmalloc(nb);
    const use = this.mem.get(this.top)!;
    // split top
    const userAddr = use.addr as Addr;
    const remainderAddr = (userAddr + nb) as Addr;
    const remainderSize = use.size - nb;
    use.inuse = true;
    use.size = nb;
    const remainder: Chunk = {
      addr: remainderAddr,
      prev_size: nb,
      size: remainderSize,
      inuse: false,
      prev_inuse: true,
      fd: null,
      bk: null,
      fd_nextsize: null,
      bk_nextsize: null,
    };
    this.mem.set(remainderAddr, remainder);
    this.top = remainderAddr;
    const n = this.nextChunk(remainder);
    if (n) {
      n.prev_size = remainder.size;
      n.prev_inuse = false;
    }

    const ret = chunk2mem(userAddr);
    this.log({ type: 'malloc', bytes, nb, result: ret, source: 'top', msg: 'malloc from top' });
    return ret;
  }

  free(ptr: Addr): void {
    if (ptr === 0 || ptr == null) {
      this.log({ type: 'error', msg: 'free(null)' });
      return;
    }
    const addr = mem2chunk(ptr);
    const c = this.mem.get(addr);
    if (!c || !c.inuse) {
      this.log({ type: 'error', msg: 'double free or invalid' });
      return;
    }

    const nb = c.size;

    // Try tcache first
    c.inuse = false;
    if (this.tcachePut(c)) {
      this.log({
        type: 'free',
        ptr,
        size: nb,
        into: 'tcache',
        msg: `free(${ptr.toString(16)}) → tcache`,
      });
      return;
    }

    // Fastbin path (exact sizes only)
    if (this.fastbinIndex(nb) >= 0) {
      // In real glibc, prev_inuse remains whatever; we do not consolidate here
      this.pushFastbin(c);
      this.log({ type: 'free', ptr, size: nb, into: 'fastbin', msg: 'free → fastbin' });
      return;
    }

    // Consolidate with neighbors and put to unsorted
    const coalesced = this.coalesce(c);
    // If resulting chunk abuts top, merge into top
    const next = this.nextChunk(coalesced);
    if (!next) {
      // shouldn't happen
    }
    if (coalesced.addr + coalesced.size === this.top) {
      // merge with top
      const top = this.mem.get(this.top)!;
      coalesced.size += top.size;
      this.mem.delete(top.addr);
      this.top = coalesced.addr;
      this.mem.set(this.top, coalesced);
      this.setPrevInuseOnNext(coalesced, false);
      this.log({ type: 'free', ptr, size: nb, into: 'top', msg: 'coalesced with top' });
      return;
    }

    // Put into unsorted (like glibc)
    this.insertUnsorted(coalesced);
    this.log({ type: 'free', ptr, size: nb, into: 'unsorted', msg: 'free → unsorted' });
  }

  private setPrevInuseOnNext(c: Chunk, inuse: boolean) {
    const n = this.nextChunk(c);
    if (n) n.prev_inuse = inuse;
  }

  private coalesce(c: Chunk): Chunk {
    let cur = c;
    cur.inuse = false;

    // try forward
    const n = this.nextChunk(cur);
    if (n && !n.inuse && n.addr !== this.top) {
      // unlink n from its bin (must be in small/large/unsorted)
      this.unlinkIfBinned(n);
      cur.size += n.size;
      this.mem.delete(n.addr);
    }

    // try backward
    const p = this.prevChunk(cur);
    if (p && !p.inuse) {
      this.unlinkIfBinned(p);
      p.size += cur.size;
      const n2 = this.nextChunk(p);
      if (n2) {
        n2.prev_size = p.size;
        n2.prev_inuse = false;
      }
      this.mem.delete(cur.addr);
      cur = p;
    }

    this.setPrevInuseOnNext(cur, false);
    this.log({
      type: 'coalesce',
      result: cur.addr,
      size: cur.size,
      parts: [c.addr],
      msg: 'coalesce neighbors if free',
    });
    return cur;
  }

  private unlinkIfBinned(c: Chunk) {
    // remove from unsorted/small/large if present; conservative check
    // Unsuitable for fastbins (fastbins are only used for inuse=false during free path)

    // unsorted?
    if (this.unsorted != null) {
      // iterate once around to see if c is in unsorted
      let head = this.mem.get(this.unsorted)!;
      let cur = head;
      do {
        if (cur.addr === c.addr) {
          // unlink
          const wasSingleton = cur.fd === cur.addr && cur.bk === cur.addr;
          if (wasSingleton) this.unsorted = null;
          else {
            const fd = this.mem.get(cur.fd!)!;
            const bk = this.mem.get(cur.bk!)!;
            fd.bk = bk.addr;
            bk.fd = fd.addr;
            if (this.unsorted === cur.addr) this.unsorted = fd.addr;
          }
          cur.fd = cur.bk = null;
          this.log({
            type: 'bin-unlink',
            bin: 'unsorted',
            addr: cur.addr,
            size: cur.size,
            msg: 'unlink for coalesce',
          });
          return;
        }
        cur = this.mem.get(cur.fd!)!;
      } while (cur.addr !== head.addr);
    }

    // smallbins
    for (let i = 0; i < this.smallbins.length; i++) {
      const headAddr = this.smallbins[i];
      if (headAddr == null) continue;
      let head = this.mem.get(headAddr)!;
      let cur = head;
      do {
        if (cur.addr === c.addr) {
          const wasSingleton = cur.fd === cur.addr && cur.bk === cur.addr;
          if (wasSingleton) this.smallbins[i] = null;
          else {
            const fd = this.mem.get(cur.fd!)!;
            const bk = this.mem.get(cur.bk!)!;
            fd.bk = bk.addr;
            bk.fd = fd.addr;
            if (this.smallbins[i] === cur.addr) this.smallbins[i] = fd.addr;
          }
          cur.fd = cur.bk = null;
          this.log({
            type: 'bin-unlink',
            bin: `smallbin[${i}]`,
            addr: cur.addr,
            size: cur.size,
            msg: 'unlink for coalesce',
          });
          return;
        }
        cur = this.mem.get(cur.fd!)!;
      } while (cur.addr !== head.addr);
    }

    // largebins (need to unlink from both rings)
    for (let i = 0; i < this.largebins.length; i++) {
      const headAddr = this.largebins[i];
      if (headAddr == null) continue;
      let head = this.mem.get(headAddr)!;
      let cur = head;
      do {
        if (cur.addr === c.addr) {
          const wasSingletonAddr = cur.fd === cur.addr && cur.bk === cur.addr;
          if (wasSingletonAddr) this.largebins[i] = null;
          else {
            const fd = this.mem.get(cur.fd!)!;
            const bk = this.mem.get(cur.bk!)!;
            fd.bk = bk.addr;
            bk.fd = fd.addr;
            if (this.largebins[i] === cur.addr) this.largebins[i] = fd.addr;
          }
          // size ring
          const fdn = this.mem.get(cur.fd_nextsize!)!;
          const bkn = this.mem.get(cur.bk_nextsize!)!;
          fdn.bk_nextsize = bkn.addr;
          bkn.fd_nextsize = fdn.addr;
          cur.fd = cur.bk = cur.fd_nextsize = cur.bk_nextsize = null;
          this.log({
            type: 'bin-unlink',
            bin: `largebin[${i}]`,
            addr: cur.addr,
            size: cur.size,
            msg: 'unlink for coalesce',
          });
          return;
        }
        cur = this.mem.get(cur.fd_nextsize!)!;
      } while (cur.addr !== head.addr);
    }
  }

  mallocConsolidate() {
    // move all fastbin chunks into the normal free lists with coalescing
    let moved = false;
    for (let i = 0; i < this.fastbins.length; i++) {
      let head = this.fastbins[i];
      while (head != null) {
        const c = this.mem.get(head)!;
        head = (c.fd ?? null) as Addr | null;
        c.fd = null;
        // coalesce like a normal free chunk
        const cc = this.coalesce(c);
        // place into unsorted (glbic behavior)
        if (cc.addr + cc.size === this.top) {
          // merge with top
          const top = this.mem.get(this.top)!;
          cc.size += top.size;
          this.mem.delete(top.addr);
          this.top = cc.addr;
          this.mem.set(this.top, cc);
          this.setPrevInuseOnNext(cc, false);
        } else {
          this.insertUnsorted(cc);
        }
        moved = true;
      }
      this.fastbins[i] = null;
    }
    if (moved)
      this.log({
        type: 'consolidate',
        msg: 'malloc_consolidate: moved fastbins into unsorted/top',
      });
  }

  // ------------------------------ Introspection ------------------------------
  read(ptr: Addr, n = 16): { from: Addr; bytes: number } {
    // dummy payload read for visualization: we don’t simulate real bytes.
    return { from: ptr, bytes: n };
  }

  getChunk(ptrOrAddr: Addr, isMemPtr = true): Chunk | undefined {
    return this.mem.get(isMemPtr ? mem2chunk(ptrOrAddr) : ptrOrAddr);
  }
}

// ----------------------------------------------------------------------------
// Scenario helpers (useful for UI testing)
// ----------------------------------------------------------------------------

export type Step =
  | { op: 'malloc'; size: number }
  | { op: 'free'; ptr: Addr }
  | { op: 'consolidate' };

export function runScenario(
  arena: Arena,
  steps: Step[]
): { snapshots: ArenaSnapshot[]; events: AllocEvent[]; ptrs: Addr[] } {
  const snaps: ArenaSnapshot[] = [];
  const ptrs: Addr[] = [];

  for (const s of steps) {
    if (s.op === 'malloc') {
      const p = arena.malloc(s.size) as Addr | null;
      if (p) ptrs.push(p);
    } else if (s.op === 'free') {
      arena.free(s.ptr);
    } else if (s.op === 'consolidate') {
      arena.mallocConsolidate();
    }
    snaps.push(arena.snapshot());
  }

  return { snapshots: snaps, events: arena.events, ptrs };
}

// ----------------------------------------------------------------------------
// Quick demo (leave commented in production; useful in Node-based tests)
// ----------------------------------------------------------------------------
/*
if (require.main === module) {
  const A = new Arena(1 << 16);
  const { ptrs } = runScenario(A, [
    { op: 'malloc', size: 24 }, // fastbin-size
    { op: 'malloc', size: 24 },
    { op: 'malloc', size: 400 }, // smallbin-size
    { op: 'free', ptr: 0 as any }, // ignored
  ]);

  // Free two small fastbin chunks (go to tcache/fastbin), then consolidate
  A.free(ptrs[0]);
  A.free(ptrs[1]);
  A.mallocConsolidate();

  // Allocate something that should come from unsorted/smallbin
  A.malloc(400);

  console.log(JSON.stringify({ events: A.events.slice(-10), snap: A.snapshot() }, null, 2));
}
*/
