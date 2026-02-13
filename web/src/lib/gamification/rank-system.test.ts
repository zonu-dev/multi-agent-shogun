import { describe, expect, it } from 'vitest';
import {
  MAX_RANK,
  MIN_RANK,
  RANK_THRESHOLDS,
  getNextRankXP,
  getRank,
  getRankDefinition,
  isRankUp,
} from './rank-system';

describe('rank-system', () => {
  it('handles negative and NaN XP at lower boundary', () => {
    expect(getRank(-1)).toBe(MIN_RANK);
    expect(getRank(Number.NaN)).toBe(MIN_RANK);
  });

  it('calculates rank around threshold boundaries', () => {
    const rank2Threshold = RANK_THRESHOLDS[1] ?? 200;
    const rank3Threshold = RANK_THRESHOLDS[2] ?? 500;

    expect(getRank(rank2Threshold - 1)).toBe(1);
    expect(getRank(rank2Threshold)).toBe(2);
    expect(getRank(rank3Threshold - 1)).toBe(2);
    expect(getRank(rank3Threshold)).toBe(3);
  });

  it('normalizes out-of-range rank definitions', () => {
    expect(getRankDefinition(-100).rank).toBe(MIN_RANK);
    expect(getRankDefinition(MAX_RANK + 100).rank).toBe(MAX_RANK);
    expect(getRankDefinition(Number.NaN).rank).toBe(MIN_RANK);
  });

  it('returns next-rank XP with boundary handling and detects rank-up events', () => {
    const rank2Threshold = RANK_THRESHOLDS[1] ?? 200;

    expect(getNextRankXP(MIN_RANK)).toBe(rank2Threshold);
    expect(getNextRankXP(MAX_RANK)).toBeNull();
    expect(getNextRankXP(Number.NaN)).toBeNull();

    expect(isRankUp(rank2Threshold - 1, rank2Threshold)).toBe(true);
    expect(isRankUp(rank2Threshold, rank2Threshold)).toBe(false);
    expect(isRankUp(rank2Threshold, rank2Threshold - 1)).toBe(false);
  });
});
