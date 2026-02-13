import { memo } from 'react';
import { useContextStore } from '@/store/contextStore';

type CommanderId = 'shogun' | 'karo';
type CommanderStatus = 'idle' | 'working' | 'unknown';

interface CommanderCardProps {
  commanderId: CommanderId;
  name?: string;
  latestSpeech?: string | null;
  onOpenDetail?: (payload: { agentId: CommanderId; role: CommanderId; name: string }) => void;
}

const COMMANDER_META: Record<
  CommanderId,
  {
    title: string;
    portraitLabel: string;
    portraitClass: string;
  }
> = {
  shogun: {
    title: '将軍',
    portraitLabel: '将',
    portraitClass:
      'border-amber-200/80 bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950',
  },
  karo: {
    title: '家老',
    portraitLabel: '家',
    portraitClass:
      'border-slate-200/80 bg-gradient-to-b from-slate-200 to-slate-400 text-slate-900',
  },
};

const STATUS_META: Record<CommanderStatus, { label: string; icon: string; badgeClass: string }> = {
  idle: {
    label: '待機',
    icon: '💤',
    badgeClass: 'border-slate-300/35 bg-slate-500/35 text-slate-100',
  },
  working: {
    label: '指揮中',
    icon: '⚒️',
    badgeClass: 'border-sky-300/35 bg-sky-500/25 text-sky-100',
  },
  unknown: {
    label: '消息不明',
    icon: '❔',
    badgeClass: 'border-slate-400/35 bg-slate-600/35 text-slate-200',
  },
};

const STATUS_FRAME_CLASS: Record<CommanderStatus, string> = {
  idle: 'border-[color:var(--kincha)]/30 bg-black/20',
  working: 'border-sky-500/40 bg-sky-500/10',
  unknown: 'border-slate-400/35 bg-slate-500/15',
};

const normalizePercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const getUsageGaugeClass = (usedPercent: number): string => {
  if (usedPercent <= 60) {
    return 'bg-emerald-500/75';
  }

  if (usedPercent <= 80) {
    return 'bg-amber-500/75';
  }

  return 'bg-rose-500/75';
};

const getFallbackSpeech = (status: CommanderStatus): string => {
  if (status === 'working') {
    return '指揮を執っておる';
  }

  if (status === 'idle') {
    return '次なるご下命を待つ';
  }

  return '伝令確認中...';
};

const normalizeCommanderStatus = (rawStatus: string | null | undefined): CommanderStatus => {
  if (rawStatus === 'done') {
    return 'idle';
  }

  if (rawStatus === 'idle' || rawStatus === 'working' || rawStatus === 'unknown') {
    return rawStatus;
  }

  return 'unknown';
};

const CommanderCardComponent = ({
  commanderId,
  name,
  latestSpeech,
  onOpenDetail,
}: CommanderCardProps) => {
  const contextStat = useContextStore((state) => state.contextStats[commanderId] ?? null);

  const meta = COMMANDER_META[commanderId];
  const status = normalizeCommanderStatus(contextStat?.status as string | undefined);
  const statusMeta = STATUS_META[status];
  const frameClass = STATUS_FRAME_CLASS[status];

  const contextLeftPercent =
    contextStat && contextStat.contextPercent !== null
      ? normalizePercent(contextStat.contextPercent)
      : null;
  const usedContextPercent =
    contextLeftPercent === null ? null : normalizePercent(100 - contextLeftPercent);
  const contextGaugeClass =
    usedContextPercent === null ? 'bg-slate-500/40' : getUsageGaugeClass(usedContextPercent);
  const speech = latestSpeech?.trim() || getFallbackSpeech(status);
  const displayName = name?.trim() || meta.title;

  return (
    <button
      type="button"
      onClick={() =>
        onOpenDetail?.({
          agentId: commanderId,
          role: commanderId,
          name: displayName,
        })
      }
      className={[
        'w-full rounded-xl border p-3.5 text-left shadow-[0_8px_16px_rgba(0,0,0,0.22)] transition hover:-translate-y-[1px] hover:border-[color:var(--kincha)]/70 hover:shadow-[0_10px_18px_rgba(0,0,0,0.26)]',
        frameClass,
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            'mt-0.5 flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-2xl font-black shadow-[inset_0_1px_6px_rgba(0,0,0,0.28)]',
            meta.portraitClass,
          ].join(' ')}
          aria-hidden="true"
        >
          {meta.portraitLabel}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={[
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                statusMeta.badgeClass,
              ].join(' ')}
              aria-label={statusMeta.label}
              title={statusMeta.label}
            >
              {statusMeta.icon}
            </span>
            <h3
              className="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide text-slate-50"
              style={{ fontFamily: '"Noto Serif JP", serif' }}
            >
              {displayName}
            </h3>
            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/20">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${contextGaugeClass}`}
                style={{ width: `${usedContextPercent ?? 0}%` }}
              />
            </div>
            <p className="w-9 shrink-0 text-right text-[10px] font-semibold text-slate-300">
              {usedContextPercent === null ? '--%' : `${usedContextPercent}%`}
            </p>
          </div>

          <div className="relative mt-2 min-h-[56px] rounded-lg border border-white/20 bg-black/25 px-3 py-2">
            <span
              className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-white/20 bg-black/25"
              aria-hidden="true"
            />
            <p className="line-clamp-3 text-[12px] leading-relaxed text-slate-100">{speech}</p>
          </div>
        </div>
      </div>
    </button>
  );
};

const CommanderCard = memo(CommanderCardComponent);
CommanderCard.displayName = 'CommanderCard';

export default CommanderCard;
