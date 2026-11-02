export function StatTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded border border-neutral-200 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-neutral-500">{unit}</span>}
      </div>
    </div>
  );
}
