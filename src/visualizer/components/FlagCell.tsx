export default function FlagCell({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={
        'w-6 h-6 border grid place-items-center text-xs font-mono ' +
        (active ? ' border-emerald-600 text-emerald-700 bg-emerald-50 ' : ' border-gray-500 ')
      }
      title={label}
    >
      {label}
    </div>
  );
}
