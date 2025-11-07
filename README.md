# visalloc — interactive heap / ptmalloc2 visualizer

<img width="1491" height="790" alt="Image" src="https://github.com/user-attachments/assets/a1c5f19d-d4ca-43d8-ad4d-f38474de26b3" />

visalloc is an educational, in-browser interactive visualizer for a ptmalloc-like allocator. It lets you allocate and free blocks, inspect bins (fastbins, smallbins, largebins, tcache, unsorted), view the top chunk, and step through recent allocator events. The project is implemented in TypeScript + React and uses Vite for development.

This repo is primarily intended as a learning tool for students, security researchers, and engineers who want to understand glibc-style allocator internals and common heap behaviors.

## Features

- Live malloc/free controls and a memory layout bar that highlights chunks and addresses.
- Visual views of unsorted bin, fastbins, smallbins, largebins, and tcache.
- Per-chunk cards showing metadata with quick selection and highlighting.
- Recent event log for allocator actions (malloc/free/consolidate/etc.).

Planned / suggested features (ideas): keybaord shortcuts + focused UX for quick expermentation, replay/time-travel of snapshots, export/import heap snapshots, deterministic scenarios (fastbin dup, off-by-one), heap corruption simulator, allocation heatmap, and multi-arena simulation.
