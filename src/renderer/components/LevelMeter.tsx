export function LevelMeter({ levels, labels }: { levels: number[]; labels: string[] }) {
  if (levels.length === 0) return null;
  return (
    <div className="flex items-center gap-3" aria-label="Input levels">
      {levels.map((level, index) => {
        const percent = Math.min(100, Math.round(Math.sqrt(level) * 100));
        return (
          <div key={labels[index] ?? index} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{labels[index] ?? `Ch ${index + 1}`}</span>
            <div
              className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={`${labels[index] ?? 'Channel'} level`}
            >
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-100" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
