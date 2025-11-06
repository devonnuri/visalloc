import React from 'react';

// Simple circle endpoint used in connectors and inside chunks
function PortCircle({ className = '' }) {
  return (
    <div className={'w-3 h-3 rounded-full border border-gray-500 bg-white shrink-0 ' + className} />
  );
}

function FlagCell({ label }: { label: string }) {
  return (
    <div className="w-6 h-6 border border-gray-500 rounded-md grid place-items-center text-sm font-mono">
      {label}
    </div>
  );
}

function FieldBox({ label }: { label: string }) {
  return (
    <div className="flex-1 h-8 border border-gray-500 rounded-md grid place-items-center text-sm font-mono">
      {label}
    </div>
  );
}

function Chunk() {
  return (
    <div className="rounded-xl border border-gray-600 bg-gray-100 shadow-sm overflow-hidden flex flex-col font-mono w-52">
      {/* Row: prev_size */}
      <div className="flex items-center justify-between px-3 py-2 text-sm">
        <span className="font-medium">0x8</span>
      </div>

      {/* Row: size + flags */}
      <div className="flex items-stretch border-t border-gray-300 px-3 py-2 text-sm">
        <span className="font-medium flex items-center">0x8</span>
        <div className="flex-1 flex items-stretch justify-end gap-0 ml-4">
          <div className="flex items-center gap-1">
            <FlagCell label="A" />
            <FlagCell label="M" />
            <FlagCell label="P" />
          </div>
        </div>
      </div>

      {/* Row: fd / bk with side ports */}
      <div className="flex items-center gap-2 border-t border-gray-300 px-3 py-2">
        <PortCircle />
        <div className="flex flex-1 items-center gap-2">
          <FieldBox label="fd" />
          <FieldBox label="bk" />
        </div>
        <PortCircle />
      </div>

      {/* Bottom area: payload/unused */}
      <div className="bg-gray-200 text-gray-700 px-3 py-4 border-t border-gray-300 text-sm">
        unused
      </div>
    </div>
  );
}

function BinRow() {
  // grid: chunk | connector | chunk | connector | chunk
  return (
    <div className="flex gap-4 flex-nowrap overflow-x-auto py-2">
      <div className="shrink-0">
        <Chunk />
      </div>
      <div className="shrink-0">
        <Chunk />
      </div>
      <div className="shrink-0">
        <Chunk />
      </div>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-gray-300 p-5 bg-white font-mono">
      <h2 className="text-gray-800 font-semibold mb-4">{title}</h2>
      <BinRow />
    </section>
  );
}

export default function Visualizer() {
  return (
    <div className="w-full min-h-screen bg-neutral-50 text-gray-900 p-6 font-mono">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6">
        <input
          placeholder=""
          className="h-8 w-28 rounded-md border border-gray-400 bg-white px-2 text-sm font-mono"
        />
        <button className="h-8 px-3 rounded-md border border-gray-600 bg-gray-200 text-sm shadow font-mono">
          malloc
        </button>
      </div>

      <div className="space-y-8">
        <Section title="bin#1 unsorted bin" />
        <Section title="bin#2 unsorted bin" />
      </div>
    </div>
  );
}
