export interface RankDefinition {
  rank: number;
  title: string;
  requiredXP: number;
}

export const RANK_DEFINITIONS: readonly RankDefinition[] = [
  { rank: 1, title: 'ashigaru', requiredXP: 0 },
  { rank: 2, title: 'kumigashira', requiredXP: 200 },
  { rank: 3, title: 'kogashira', requiredXP: 500 },
  { rank: 4, title: 'yoriki', requiredXP: 1000 },
  { rank: 5, title: 'doshin', requiredXP: 2000 },
  { rank: 6, title: 'samurai', requiredXP: 3500 },
  { rank: 7, title: 'bushi', requiredXP: 5500 },
  { rank: 8, title: 'samurai_taisho', requiredXP: 8000 },
  { rank: 9, title: 'daimyo', requiredXP: 12000 },
  { rank: 10, title: 'shogun', requiredXP: 20000 },
] as const;

export const RANK_THRESHOLDS: readonly number[] = RANK_DEFINITIONS.map(
  (definition) => definition.requiredXP
);

export const MIN_RANK = RANK_DEFINITIONS[0].rank;
export const MAX_RANK = RANK_DEFINITIONS[RANK_DEFINITIONS.length - 1].rank;

export const getRank = (xp: number): number => {
  const safeXP = Math.max(0, Math.floor(xp));
  let currentRank = MIN_RANK;

  for (let i = 0; i < RANK_DEFINITIONS.length; i += 1) {
    if (safeXP >= (RANK_THRESHOLDS[i] ?? Number.POSITIVE_INFINITY)) {
      currentRank = RANK_DEFINITIONS[i].rank;
      continue;
    }
    break;
  }

  return currentRank;
};

export const getRankDefinition = (rank: number): RankDefinition => {
  const normalized = Math.min(Math.max(Math.trunc(rank), MIN_RANK), MAX_RANK);
  const found = RANK_DEFINITIONS.find((definition) => definition.rank === normalized);

  if (found) {
    return found;
  }

  return RANK_DEFINITIONS[0];
};

export const getNextRankXP = (rank: number): number | null => {
  const normalized = Math.min(Math.max(Math.trunc(rank), MIN_RANK), MAX_RANK);
  const next = RANK_DEFINITIONS.find((definition) => definition.rank === normalized + 1);
  return next?.requiredXP ?? null;
};

export const isRankUp = (oldXP: number, newXP: number): boolean => getRank(newXP) > getRank(oldXP);
