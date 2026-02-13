import { useMemo } from 'react';
import { TOWN_LEVEL_XP_THRESHOLDS } from '@/types';
import { useGameStore } from '@/store/gameStore';

const DEFAULT_TOWN = {
  level: 1,
  xp: 0,
  gold: 0,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const RANK_LABELS: Record<string, string> = {
  ashigaru: '足軽',
  kumigashira: '組頭',
  kogashira: '小頭',
  yoriki: '与力',
  doshin: '同心',
  samurai: '侍',
  bushi: '武士',
  samurai_taisho: '侍大将',
  daimyo: '大名',
  shogun: '将軍',
};

const StatusBar = () => {
  const gameState = useGameStore((state) => state.gameState);
  const town = useGameStore((state) => state.gameState?.town ?? DEFAULT_TOWN);
  const townRank = useGameStore((state) => state.townRank);
  const equippedTitle = useGameStore((state) => {
    const gameState = state.gameState;
    if (!gameState?.equippedTitle) {
      return '未装備';
    }

    const matched = gameState.titles.find((title) => title.id === gameState.equippedTitle);
    return matched?.name ?? gameState.equippedTitle;
  });

  const xpInfo = useMemo(() => {
    const safeLevel = Math.max(1, Math.floor(town.level));
    const safeXp = Math.max(0, Math.floor(town.xp));
    const currentLevelStart =
      TOWN_LEVEL_XP_THRESHOLDS[Math.min(safeLevel - 1, TOWN_LEVEL_XP_THRESHOLDS.length - 1)] ?? 0;
    const nextLevelXp = TOWN_LEVEL_XP_THRESHOLDS[safeLevel] ?? null;

    if (nextLevelXp === null) {
      return {
        progress: 100,
        label: `修練値 ${safeXp.toLocaleString()} / 極`,
      };
    }

    const span = Math.max(1, nextLevelXp - currentLevelStart);
    const progress = clamp(((safeXp - currentLevelStart) / span) * 100, 0, 100);

    return {
      progress,
      label: `修練値 ${safeXp.toLocaleString()} / ${nextLevelXp.toLocaleString()}`,
    };
  }, [town.level, town.xp]);

  const townRankTitle = townRank?.title ?? '';
  const rankLabel = RANK_LABELS[townRankTitle] ?? (townRankTitle || '不明');
  const xpProgressValue = Math.round(clamp(xpInfo.progress, 0, 100));

  if (!gameState) {
    return (
      <section className="status-bar panel" aria-busy="true" aria-live="polite">
        <div className="status-bar__meta animate-pulse">
          <p className="status-bar__label">城下町</p>
          <p className="status-bar__level text-slate-300" style={{ fontFamily: '"Noto Serif JP", serif' }}>
            読込中...
          </p>
          <p className="status-bar__rank text-slate-400">位階: --</p>
          <p className="status-bar__title text-slate-400">装備称号: --</p>
        </div>

        <div className="status-bar__xp-wrap animate-pulse">
          <div className="status-bar__xp-track" role="presentation">
            <div className="status-bar__xp-fill" style={{ width: '35%', opacity: 0.35 }} />
          </div>
          <p className="status-bar__xp-text text-slate-400">修練値を読込中...</p>
        </div>

        <div className="status-bar__gold animate-pulse">
          <p className="status-bar__label">軍資金</p>
          <p className="status-bar__gold-value text-slate-300" style={{ fontFamily: '"Noto Serif JP", serif' }}>
            --両
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="status-bar panel">
      <div className="status-bar__meta">
        <p className="status-bar__label">城下町</p>
        <p className="status-bar__level" style={{ fontFamily: '"Noto Serif JP", serif' }}>
          格 {town.level}
        </p>
        <p className="status-bar__rank">位階: {rankLabel}</p>
        <p className="status-bar__title">装備称号: {equippedTitle}</p>
      </div>

      <div className="status-bar__xp-wrap">
        <div
          className="status-bar__xp-track"
          role="progressbar"
          aria-valuenow={xpProgressValue}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="status-bar__xp-fill" style={{ width: `${xpInfo.progress}%` }} />
        </div>
        <p className="status-bar__xp-text">{xpInfo.label}</p>
      </div>

      <div className="status-bar__gold">
        <p className="status-bar__label">軍資金</p>
        <p className="status-bar__gold-value" style={{ fontFamily: '"Noto Serif JP", serif' }}>
          {Math.max(0, Math.floor(town.gold)).toLocaleString()}両
        </p>
      </div>
    </section>
  );
};

export default StatusBar;
