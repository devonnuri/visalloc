import React from 'react';

export default function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="border border-gray-300 p-3 bg-white font-mono">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-gray-800 font-semibold text-sm">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
