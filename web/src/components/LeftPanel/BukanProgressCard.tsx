import type { ProgressCardModel } from './useBukanData';

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const formatNumber = (value: number): string => toNonNegativeInt(value).toLocaleString('ja-JP');

const formatProgressValue = (value: number, unit: string): string => {
  const number = formatNumber(value);
  if (unit === '%') {
    return `${number}%`;
  }
  if (unit.length < 1) {
    return number;
  }
  return `${number}${unit}`;
};

export const BukanProgressCard = ({ card }: { card: ProgressCardModel }) => {
  const safeTarget = Math.max(1, card.target);
  const progressPercent = Math.min(100, Math.round((card.current / safeTarget) * 100));

  return (
    <article className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-100">{card.name}</p>
          <p className="text-[10px] text-slate-300">{card.description}</p>
        </div>
        <span
          className={[
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
            card.completed
              ? 'border-amber-300/70 bg-amber-500/15 text-amber-100'
              : 'border-slate-400/30 bg-black/30 text-slate-300',
          ].join(' ')}
        >
          {card.completed ? '✅ 達成' : `${progressPercent}%`}
        </span>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full border border-[color:var(--kincha)]/25 bg-black/35">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-300/80 to-[color:var(--kincha)] transition-all"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <p className="mt-1 text-[11px] text-slate-300">
        進捗 {formatProgressValue(card.current, card.unit)} / {formatProgressValue(card.target, card.unit)}
      </p>
      {card.detail ? <p className="text-[10px] text-slate-400">{card.detail}</p> : null}
    </article>
  );
};

interface BukanCardListProps {
  cards: readonly ProgressCardModel[];
  emptyMessage: string;
}

export const BukanCardList = ({ cards, emptyMessage }: BukanCardListProps) => {
  if (cards.length < 1) {
    return (
      <p className="rounded border border-dashed border-slate-500/35 px-2 py-1 text-[11px] text-slate-300">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {cards.map((card) => (
        <BukanProgressCard key={`bukan-progress-${card.id}`} card={card} />
      ))}
    </div>
  );
};
