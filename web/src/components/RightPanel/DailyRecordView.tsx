import { useMemo } from 'react';
import type { DailyRecord } from '@/types';
import { useGameStore } from '@/store/gameStore';

const resolveLocalDateKey = (): string => {
  const now = new Date();
  const offsetMillis = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMillis).toISOString().slice(0, 10);
};

const formatDateLabel = (dateKey: string): string => {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dateKey;
  }

  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
};

const resolveBestRecord = (records: DailyRecord[]): DailyRecord | null => {
  if (records.length === 0) {
    return null;
  }

  return records.reduce((best, current) => {
    if (current.tasksCompleted > best.tasksCompleted) {
      return current;
    }

    if (current.tasksCompleted === best.tasksCompleted && current.date > best.date) {
      return current;
    }

    return best;
  });
};

const DailyRecordView = () => {
  const dailyRecords = useGameStore((state) => state.gameState?.dailyRecords ?? []);

  const { todayRecord, bestRecord, taskDiff, isNewRecord } = useMemo(() => {
    const sortedRecords = [...dailyRecords].sort((left, right) =>
      left.date.localeCompare(right.date)
    );
    const todayDate = resolveLocalDateKey();
    const today = sortedRecords.find((record) => record.date === todayDate) ?? null;
    const best = resolveBestRecord(sortedRecords);
    const bestBeforeToday = sortedRecords.reduce((currentBest, record) => {
      if (record.date < todayDate) {
        return Math.max(currentBest, record.tasksCompleted);
      }
      return currentBest;
    }, 0);
    const baseline = today?.previousBest ?? bestBeforeToday;
    const diff = today ? today.tasksCompleted - baseline : null;

    return {
      todayRecord: today,
      bestRecord: best,
      taskDiff: diff,
      isNewRecord: today ? today.tasksCompleted > baseline : false,
    };
  }, [dailyRecords]);

  return (
    <section className="rounded-xl border border-[color:var(--kincha)]/35 bg-gradient-to-br from-black/35 via-[#2f1d0e]/45 to-[#1f140a]/45 p-3 text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,212,153,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          className="text-sm font-semibold text-[color:var(--kincha)]"
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          日次自己記録
        </h3>
        {isNewRecord ? (
          <span className="rounded-full border border-amber-200/55 bg-amber-500/25 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
            新記録！
          </span>
        ) : null}
      </div>

      {todayRecord ? (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-[color:var(--kincha)]/25 bg-black/20 px-2 py-1.5">
              <p className="text-slate-300">完了</p>
              <p className="mt-0.5 text-base font-semibold text-slate-50">
                {todayRecord.tasksCompleted}件
              </p>
            </div>
            <div className="rounded-md border border-[color:var(--kincha)]/25 bg-black/20 px-2 py-1.5">
              <p className="text-slate-300">修練値</p>
              <p className="mt-0.5 text-base font-semibold text-sky-100">+{todayRecord.xp}</p>
            </div>
            <div className="rounded-md border border-[color:var(--kincha)]/25 bg-black/20 px-2 py-1.5">
              <p className="text-slate-300">小判</p>
              <p className="mt-0.5 text-base font-semibold text-amber-100">+{todayRecord.gold}</p>
            </div>
          </div>

          <div className="mt-2 rounded-md border border-[color:var(--kincha)]/25 bg-black/20 px-2 py-2 text-xs">
            <p className="text-slate-200">
              自己ベスト:
              {bestRecord ? (
                <span className="ml-1 font-semibold text-slate-50">
                  {bestRecord.tasksCompleted}件 ({formatDateLabel(bestRecord.date)})
                </span>
              ) : (
                <span className="ml-1 text-slate-400">記録なし</span>
              )}
            </p>
            <p className="mt-1 text-slate-300">
              比較:
              <span
                className={[
                  'ml-1 font-semibold',
                  taskDiff === null
                    ? 'text-slate-200'
                    : taskDiff > 0
                      ? 'text-emerald-200'
                      : taskDiff < 0
                        ? 'text-rose-200'
                        : 'text-slate-200',
                ].join(' ')}
              >
                {taskDiff === null ? '対象なし' : `${taskDiff > 0 ? '+' : ''}${taskDiff}件`}
              </span>
            </p>
          </div>
        </>
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-[color:var(--kincha)]/30 bg-black/20 px-2 py-2 text-xs text-slate-300">
          本日の完了報告を受けると、ここに日次記録が刻まれる。
        </p>
      )}
    </section>
  );
};

export default DailyRecordView;
