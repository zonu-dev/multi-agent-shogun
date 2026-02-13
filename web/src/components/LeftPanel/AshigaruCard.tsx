import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AshigaruState, ReportUpdatePayload } from '@/types';
import { useContextStore } from '@/store/contextStore';
import { useReportStore } from '@/store/reportStore';
import { useTaskStore } from '@/store/taskStore';
import { useUIStore } from '@/store/uiStore';

interface AshigaruCardProps {
  workerId: string;
  memberName?: string | null;
  memberStatus?: AshigaruState['status'] | null;
  memberTaskId?: string | null;
  resolvedTaskTitle?: string | null;
  taskTitleLookupStatus?: TaskTitleLookupStatus;
  onOpenDetail?: (payload: { agentId: string; role: 'ashigaru'; name: string }) => void;
}

type CardStatus = 'idle' | 'working' | 'failed' | 'done';
export type TaskTitleLookupStatus = 'idle' | 'loading' | 'ready' | 'failed';
type SpeechTone = 'normal' | 'idle' | 'loading' | 'fallback';

interface SpeechContent {
  text: string;
  tone: SpeechTone;
}

const COMPLETION_HIGHLIGHT_MS = 4000;

const WORKER_NAMES: Record<string, string> = {
  ashigaru1: '足軽壱',
  ashigaru2: '足軽弐',
  ashigaru3: '足軽参',
  ashigaru4: '足軽四',
  ashigaru5: '足軽五',
  ashigaru6: '足軽六',
  ashigaru7: '足軽七',
  ashigaru8: '足軽八',
};

const STATUS_META: Record<CardStatus, { label: string; icon: string; badgeClass: string }> = {
  idle: {
    label: '待機',
    icon: '💤',
    badgeClass: 'border-slate-300/35 bg-slate-500/25 text-slate-100',
  },
  done: {
    label: '完了',
    icon: '🏅',
    badgeClass: 'border-emerald-300/45 bg-emerald-500/20 text-emerald-100',
  },
  working: {
    label: '作業中',
    icon: '⚒️',
    badgeClass: 'border-sky-300/35 bg-sky-500/25 text-sky-100',
  },
  failed: {
    label: '負傷',
    icon: '⚠️',
    badgeClass: 'border-rose-300/35 bg-rose-500/25 text-rose-100',
  },
};

const STATUS_FRAME_CLASS: Record<CardStatus, string> = {
  idle: 'border-[color:var(--kincha)]/30 bg-black/20',
  done: 'border-emerald-500/45 bg-emerald-500/10',
  working: 'border-sky-500/40 bg-sky-500/10',
  failed: 'border-rose-500/40 bg-rose-500/10',
};

const SPEECH_TONE_CLASS: Record<SpeechTone, string> = {
  normal: 'text-[12px] leading-relaxed text-slate-200',
  idle: 'text-[12px] leading-relaxed text-slate-400',
  loading: 'text-[12px] italic leading-relaxed text-slate-400',
  fallback: 'text-[12px] italic leading-relaxed text-slate-500/85 opacity-80',
};

const getCardStatus = (
  memberStatus: AshigaruState['status'] | null,
  memberTaskId: string | null,
  shouldHighlightDone: boolean
): CardStatus => {
  if (memberStatus === 'blocked' || memberStatus === 'offline') {
    return 'failed';
  }

  if (memberStatus === 'working' || (typeof memberTaskId === 'string' && memberTaskId.trim().length > 0)) {
    return 'working';
  }

  if (shouldHighlightDone) {
    return 'done';
  }

  return 'idle';
};

const normalizePercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const getUsageGaugeClass = (usedPercent: number): string => {
  if (usedPercent <= 60) {
    return 'bg-emerald-500/70';
  }

  if (usedPercent <= 80) {
    return 'bg-amber-500/70';
  }

  return 'bg-rose-500/70';
};

const getPortraitLabel = (workerId: string, fallbackName: string): string => {
  const suffix = workerId.match(/(\d+)$/)?.[1];
  if (suffix) {
    return suffix;
  }

  const tailChar = fallbackName.trim().slice(-1);
  return tailChar || '兵';
};

const getLatestSpeech = (
  cardStatus: CardStatus,
  taskTitle: string | null,
  report: ReportUpdatePayload | null,
  taskTitleLookupStatus: TaskTitleLookupStatus
): SpeechContent => {
  if (cardStatus === 'failed') {
    const failureSummary = report?.summary?.trim();
    if (failureSummary) {
      return {
        text: `障害発生: ${failureSummary}`,
        tone: 'fallback',
      };
    }

    return {
      text: '障害発生',
      tone: 'fallback',
    };
  }

  if (cardStatus === 'working') {
    if (taskTitle) {
      return {
        text: `${taskTitle} を遂行中`,
        tone: 'normal',
      };
    }

    return {
      text: '伝令確認中...',
      tone: taskTitleLookupStatus === 'failed' ? 'fallback' : 'loading',
    };
  }

  if (cardStatus === 'done') {
    const completionSummary = report?.summary?.trim();
    if (completionSummary) {
      return {
        text: `完了報告: ${completionSummary}`,
        tone: 'normal',
      };
    }

    return {
      text: '任務完了、恩賞受領',
      tone: 'normal',
    };
  }

  if (cardStatus === 'idle') {
    return {
      text: '待機中',
      tone: 'idle',
    };
  }

  if (taskTitle) {
    return {
      text: `${taskTitle} を遂行中`,
      tone: 'normal',
    };
  }

  if (taskTitleLookupStatus === 'failed') {
    return {
      text: '伝令未到着',
      tone: 'fallback',
    };
  }

  return {
    text: '控えておる',
    tone: 'idle',
  };
};

const AshigaruCardComponent = ({
  workerId,
  memberName = null,
  memberStatus = null,
  memberTaskId = null,
  resolvedTaskTitle = null,
  taskTitleLookupStatus = 'idle',
  onOpenDetail,
}: AshigaruCardProps) => {
  const task = useTaskStore((state) => state.tasks[workerId] ?? null);
  const report = useReportStore((state) => state.reports[workerId] ?? null);
  const contextStat = useContextStore((state) => state.contextStats[workerId] ?? null);
  const selectedAshigaru = useUIStore((state) => state.selectedAshigaru);
  const selectAshigaru = useUIStore((state) => state.selectAshigaru);
  const [doneHighlightUntil, setDoneHighlightUntil] = useState(0);
  const highlightedReportIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (report?.status !== 'done') {
      return;
    }

    if (highlightedReportIdRef.current === report.reportId) {
      return;
    }

    highlightedReportIdRef.current = report.reportId;
    setDoneHighlightUntil(Date.now() + COMPLETION_HIGHLIGHT_MS);
  }, [report?.reportId, report?.status]);

  useEffect(() => {
    const now = Date.now();
    if (doneHighlightUntil <= now) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDoneHighlightUntil(0);
    }, doneHighlightUntil - now);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [doneHighlightUntil]);

  const hasMatchingDoneReport =
    report?.status === 'done' &&
    (task === null || task.taskId === report.taskId || task.status === 'done');
  const shouldHighlightDone =
    hasMatchingDoneReport &&
    task?.status !== 'assigned' &&
    task?.status !== 'in_progress' &&
    doneHighlightUntil > 0;

  const cardStatus = getCardStatus(memberStatus, memberTaskId, shouldHighlightDone);
  const statusMeta = STATUS_META[cardStatus];
  const isSelected = selectedAshigaru === workerId;
  const frameClass = STATUS_FRAME_CLASS[cardStatus];

  const name = memberName ?? WORKER_NAMES[workerId] ?? workerId;
  const contextLeftPercent =
    contextStat && contextStat.contextPercent !== null
      ? normalizePercent(contextStat.contextPercent)
      : null;
  const usedContextPercent =
    contextLeftPercent === null ? null : normalizePercent(100 - contextLeftPercent);
  const contextGaugeClass =
    usedContextPercent === null ? 'bg-slate-500/40' : getUsageGaugeClass(usedContextPercent);
  const directTaskTitle = task?.taskTitle?.trim() || null;
  const normalizedTaskTitleLookupStatus: TaskTitleLookupStatus = directTaskTitle
    ? 'ready'
    : taskTitleLookupStatus;
  const displayTaskTitle = directTaskTitle ?? resolvedTaskTitle ?? null;
  const shouldShowContextUsage = cardStatus === 'working' || cardStatus === 'failed';
  const idleStateLabel = cardStatus === 'done' ? '完了' : '待機中';
  const latestSpeech = useMemo(
    () => getLatestSpeech(cardStatus, displayTaskTitle, report, normalizedTaskTitleLookupStatus),
    [cardStatus, displayTaskTitle, report, normalizedTaskTitleLookupStatus]
  );

  return (
    <button
      type="button"
      onClick={() => {
        selectAshigaru(workerId);
        onOpenDetail?.({
          agentId: workerId,
          role: 'ashigaru',
          name,
        });
      }}
      className={[
        'w-full rounded-xl border p-3 text-left transition hover:-translate-y-[1px] hover:border-[color:var(--kincha)]/70 hover:shadow-[0_8px_14px_rgba(0,0,0,0.28)]',
        frameClass,
        isSelected ? 'ring-1 ring-[color:var(--kincha)]/65' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            'mt-0.5 flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-2xl font-black shadow-[inset_0_1px_6px_rgba(0,0,0,0.28)]',
            isSelected
              ? 'border-[color:var(--kincha)]/95 bg-[color:var(--kincha)]/60 text-[color:var(--sumikuro)]'
              : 'border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/25 text-[color:var(--kincha)]',
          ].join(' ')}
          aria-hidden="true"
        >
          {getPortraitLabel(workerId, name)}
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
              {name}
            </h3>
            <span
              className="shrink-0 rounded-full border border-[color:var(--kincha)]/35 bg-[color:var(--kincha)]/15 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--kincha)]"
              title="押すと詳細画面で名を改められる"
            >
              ✎ 名編集
            </span>
            {shouldShowContextUsage ? (
              <>
                <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-black/40 ring-1 ring-[color:var(--kincha)]/25">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${contextGaugeClass}`}
                    style={{ width: `${usedContextPercent ?? 0}%` }}
                  />
                </div>
                <p className="w-9 shrink-0 text-right text-[10px] font-semibold text-slate-300">
                  {usedContextPercent === null ? '--%' : `${usedContextPercent}%`}
                </p>
              </>
            ) : (
              <p className="shrink-0 rounded-full border border-slate-300/30 bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                {idleStateLabel}
              </p>
            )}
          </div>

          <div className="relative mt-2 min-h-[56px] rounded-lg border border-[color:var(--kincha)]/20 bg-black/25 px-3 py-2">
            <span
              className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[color:var(--kincha)]/20 bg-black/25"
              aria-hidden="true"
            />
            <p className={`line-clamp-3 ${SPEECH_TONE_CLASS[latestSpeech.tone]}`}>
              {latestSpeech.text}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
};

const AshigaruCard = memo(AshigaruCardComponent);
AshigaruCard.displayName = 'AshigaruCard';

export default AshigaruCard;
