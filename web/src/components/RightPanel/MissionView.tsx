import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameState, Mission } from '@/types';
import { showOperationNotice, type OperationNoticeTone } from '@/lib/ui/operationNotice';
import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';
import { parseMissionCondition, toMissionConditionLabel } from '@/lib/gamification/mission-system';

const API_AUTH_HEADER = 'x-shogun-token';
const DEFAULT_API_AUTH_TOKEN = 'shogun-local-dev-token';
const ESTIMATED_MISSION_PROGRESS_FALLBACK = '進捗: -- (推定)';
const ESTIMATED_CONDITION_NOTE =
  '※ 条件別進捗はAPI未提供のため、全体進捗からの推定表示でござる。';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isGameStatePayload = (value: unknown): value is GameState =>
  isRecord(value) &&
  Array.isArray(value.ashigaru) &&
  Array.isArray(value.buildings) &&
  isRecord(value.town) &&
  isRecord(value.economy) &&
  Array.isArray(value.inventory) &&
  Array.isArray(value.decorations) &&
  Array.isArray(value.missions) &&
  Array.isArray(value.activityLog);

const resolveApiAuthToken = (): string => {
  const envToken =
    typeof import.meta.env.VITE_SHOGUN_API_TOKEN === 'string'
      ? import.meta.env.VITE_SHOGUN_API_TOKEN.trim()
      : '';

  if (envToken.length > 0) {
    return envToken;
  }

  return DEFAULT_API_AUTH_TOKEN;
};

interface ConditionProgressViewModel {
  key: string;
  label: string;
  current: number;
  target: number;
  isComplete: boolean;
  isEstimated: boolean;
}

interface MissionProgressViewModel {
  current: number;
  target: number;
  ratio: number;
  percent: number;
  isComplete: boolean;
}

interface MissionCompletionNotice {
  missionId: string;
  message: string;
  tone: 'success' | 'error' | 'info';
}

const toMissionProgressViewModel = (mission: Mission): MissionProgressViewModel => {
  const target = Math.max(1, mission.progress?.target ?? 0);
  const rawCurrent = Math.max(0, mission.progress?.current ?? 0);
  const current = mission.claimed === true ? target : Math.min(target, rawCurrent);
  const ratio = current / target;

  return {
    current,
    target,
    ratio,
    percent: Math.min(100, ratio * 100),
    isComplete: ratio >= 1,
  };
};

const toEstimatedMissionProgressLabel = (
  mission: Mission,
  missionProgress: MissionProgressViewModel
): string => {
  if (!Number.isFinite(mission.progress?.target) || mission.progress.target <= 0) {
    return ESTIMATED_MISSION_PROGRESS_FALLBACK;
  }

  return `進捗: ~${Math.round(missionProgress.percent)}% (推定)`;
};

const resolveConditionTarget = (condition: string): number => {
  const parsedCondition = parseMissionCondition(condition);
  if (parsedCondition === null) {
    return 1;
  }

  if (parsedCondition.type === 'task_count') {
    return Math.max(1, parsedCondition.target);
  }

  if (parsedCondition.type === 'total_time') {
    return Math.max(1, parsedCondition.targetMinutes);
  }

  return Math.max(1, parsedCondition.target);
};

const toConditionProgressViewModels = (
  mission: Mission,
  missionProgress: MissionProgressViewModel
): ConditionProgressViewModel[] => {
  if (!Array.isArray(mission.conditions) || mission.conditions.length < 1) {
    return [];
  }

  // Mission payload currently provides aggregate progress only.
  // Distribute current progress deterministically to keep condition-level UI stable.
  let remainingCurrent = missionProgress.current;

  return mission.conditions.map((condition, index) => {
    const target = resolveConditionTarget(condition);
    const current = Math.min(target, remainingCurrent);
    remainingCurrent = Math.max(0, remainingCurrent - current);

    return {
      key: `${mission.id}-${index}`,
      label: toMissionConditionLabel(condition),
      current,
      target,
      isComplete: current >= target,
      isEstimated: true,
    };
  });
};

const MissionView = () => {
  const gameState = useGameStore((state) => state.gameState);
  const updateGameState = useGameStore((state) => state.updateGameState);
  const openPopup = useUIStore((state) => state.openPopup);
  const notifyOperation = useCallback(
    (message: string, tone: OperationNoticeTone = 'info', title?: string) => {
      showOperationNotice(openPopup, message, { tone, title });
    },
    [openPopup]
  );
  const [claimingMissionId, setClaimingMissionId] = useState<string | null>(null);
  const [expandedMissionNotes, setExpandedMissionNotes] = useState<Record<string, boolean>>({});
  const [completionNotice, setCompletionNotice] = useState<MissionCompletionNotice | null>(null);

  const missions = useMemo(() => gameState?.missions ?? [], [gameState?.missions]);
  const sortedMissions = useMemo(
    () =>
      [...missions].sort((a, b) => {
        const getPriority = (mission: Mission) => {
          if (mission.claimed) return 2;

          const missionProgress = toMissionProgressViewModel(mission);
          if (missionProgress.isComplete) return 0;

          return 1;
        };

        return getPriority(a) - getPriority(b);
      }),
    [missions]
  );

  useEffect(() => {
    if (completionNotice === null || typeof window === 'undefined') {
      return;
    }

    const timer = window.setTimeout(() => {
      setCompletionNotice(null);
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [completionNotice]);

  const claimReward = async (mission: Mission) => {
    const missionProgress = toMissionProgressViewModel(mission);
    const rewardXp = mission.reward?.xp ?? 0;
    const rewardGold = mission.reward?.gold ?? 0;

    if (mission.claimed) {
      notifyOperation('既に拝領済みでござる。', 'info', mission.title);
      return;
    }

    if (missionProgress.ratio < 1) {
      notifyOperation('達成条件が未達でござる。', 'error', mission.title);
      return;
    }

    setClaimingMissionId(mission.id);

    try {
      const apiAuthToken = resolveApiAuthToken();
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiAuthToken.length > 0) {
        requestHeaders[API_AUTH_HEADER] = apiAuthToken;
      }

      const response = await fetch('/api/claim-reward', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ missionId: mission.id }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        gameState?: unknown;
      } | null;
      if (response.status === 409) {
        notifyOperation('既に拝領済みでござる。', 'info', mission.title);
        return;
      }

      if (response.status === 401) {
        notifyOperation(
          payload?.error ?? '認証に失敗いたした。認証札を確認されよ。',
          'error',
          mission.title
        );
        return;
      }

      if (!response.ok) {
        notifyOperation(payload?.error ?? '褒美拝領に失敗いたした。', 'error', mission.title);
        return;
      }

      if (isGameStatePayload(payload?.gameState)) {
        updateGameState(payload.gameState);
      }

      notifyOperation(`褒美を賜った: +${rewardGold}両 / +${rewardXp}修練値`, 'success', mission.title);
      setCompletionNotice({
        missionId: mission.id,
        message: `${mission.title} 成就。褒美 +${rewardGold}両 / +${rewardXp}修練値 を拝領した。`,
        tone: 'success',
      });
    } catch {
      notifyOperation('通信に失敗いたした。時をおいて再試行されよ。', 'error', mission.title);
      setCompletionNotice({
        missionId: mission.id,
        message: `${mission.title} の褒美拝領に失敗いたした。`,
        tone: 'error',
      });
    } finally {
      setClaimingMissionId((current) => (current === mission.id ? null : current));
    }
  };

  const toggleMissionNote = (missionId: string) => {
    setExpandedMissionNotes((current) => ({
      ...current,
      [missionId]: !current[missionId],
    }));
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm text-slate-100">
      <section
        className="min-h-10 rounded-xl border border-[color:var(--kincha)]/30 bg-black/20 px-3 py-2"
        aria-live="polite"
      >
        {completionNotice ? (
          <p
            className={[
              'text-xs',
              completionNotice.tone === 'success'
                ? 'text-emerald-200'
                : completionNotice.tone === 'error'
                  ? 'text-rose-200'
                  : 'text-slate-200',
            ].join(' ')}
          >
            {completionNotice.message}
          </p>
        ) : (
          <p className="text-[11px] text-slate-400">
            完了報せはここに五秒表示される。成就後の確認に使われよ。
          </p>
        )}
      </section>

      {sortedMissions.length === 0 ? (
        <section className="min-w-0 rounded-xl border border-[color:var(--kincha)]/30 bg-black/20 p-3 text-xs text-slate-300">
          御触書なし。新たな下知を待つべし。
        </section>
      ) : null}
      {sortedMissions.map((mission) => {
        const missionProgress = toMissionProgressViewModel(mission);
        const conditionProgresses = toConditionProgressViewModels(mission, missionProgress);
        const rewardXp = mission.reward?.xp ?? 0;
        const rewardGold = mission.reward?.gold ?? 0;
        const isComplete = missionProgress.isComplete;
        const isClaimed = mission.claimed === true;
        const isClaiming = claimingMissionId === mission.id;
        const isNoteExpanded = expandedMissionNotes[mission.id] === true;
        const missionProgressLabel = toEstimatedMissionProgressLabel(mission, missionProgress);

        return (
          <article
            key={mission.id}
            className="min-w-0 rounded-xl border border-[color:var(--kincha)]/30 bg-black/20 p-2"
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <h4
                className="min-w-0 break-words text-sm font-semibold text-slate-50"
                style={{ fontFamily: '"Noto Serif JP", serif' }}
              >
                {mission.title}
              </h4>
              <span
                className={[
                  'shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  isClaimed
                    ? 'bg-slate-500/40 text-slate-100'
                    : isComplete
                      ? 'bg-emerald-500/25 text-emerald-100'
                      : 'bg-sky-500/25 text-sky-100',
                ].join(' ')}
              >
                {isClaimed ? '拝領済' : isComplete ? '成就' : '遂行中'}
              </span>
            </div>

            <ul className="min-w-0 space-y-0.5 text-xs text-slate-200">
              {conditionProgresses.length > 0 ? (
                conditionProgresses.map((condition) => (
                  <li
                    key={condition.key}
                    className="flex min-w-0 items-center justify-between gap-2"
                  >
                    <span className="min-w-0 break-words">・{condition.label}</span>
                    <span
                      className={[
                        'shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                        condition.isComplete
                          ? 'bg-emerald-500/25 text-emerald-100'
                          : 'bg-slate-500/30 text-slate-200',
                      ].join(' ')}
                    >
                      {`${Math.min(condition.current, condition.target)}/${condition.target}${condition.isEstimated ? ' (推定)' : ''}`}
                    </span>
                  </li>
                ))
              ) : (
                <li className="break-words">・達成条件なし</li>
              )}
            </ul>

            <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
              <p className="text-[11px] text-slate-300">{missionProgressLabel}</p>
              {conditionProgresses.length > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleMissionNote(mission.id)}
                  aria-expanded={isNoteExpanded}
                  className="shrink-0 rounded-md border border-slate-400/40 bg-black/30 px-2 py-0.5 text-[10px] font-semibold text-slate-200 transition hover:bg-black/40"
                >
                  {isNoteExpanded ? '注記を閉じる' : '注記を表示'}
                </button>
              ) : null}
            </div>
            {conditionProgresses.length > 0 && isNoteExpanded ? (
              <p className="mt-1 break-words text-[10px] text-slate-400">{ESTIMATED_CONDITION_NOTE}</p>
            ) : null}

            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/35 ring-1 ring-[color:var(--kincha)]/25">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500/70 to-emerald-500/80"
                style={{ width: `${missionProgress.percent}%` }}
              />
            </div>

            <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-xs">
              <p className="min-w-0 break-words text-[color:var(--kincha)]">
                褒美: +{rewardXp}修練値 / +{rewardGold}両
              </p>
              {isComplete && !isClaimed ? (
                <button
                  type="button"
                  onClick={() => claimReward(mission)}
                  disabled={isClaiming}
                  className="shrink-0 rounded-md border border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 px-2.5 py-1 font-semibold text-[color:var(--kincha)] transition hover:bg-[color:var(--kincha)]/30 disabled:cursor-not-allowed disabled:border-slate-500/50 disabled:bg-slate-500/20 disabled:text-slate-300"
                >
                  {isClaiming ? '拝領中...' : '褒美拝領'}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
};

export default MissionView;
