import { describe, expect, it } from 'vitest';
import type { TaskCategory } from '../../types/game';
import {
  BASE_XP_BY_CATEGORY,
  SPEED_BONUS_MULTIPLIER,
  SPEED_BONUS_THRESHOLD_MINUTES,
  STREAK_BONUS_MULTIPLIER,
  STREAK_BONUS_THRESHOLD,
  calculateTaskXP,
  getSpeedBonus,
  getStreakBonus,
} from './xp-calculator';

describe('xp-calculator', () => {
  it('applies speed bonus on threshold boundary values', () => {
    expect(getSpeedBonus(SPEED_BONUS_THRESHOLD_MINUTES - 0.01)).toBe(SPEED_BONUS_MULTIPLIER);
    expect(getSpeedBonus(SPEED_BONUS_THRESHOLD_MINUTES)).toBe(1);
  });

  it('applies streak bonus on threshold boundary values', () => {
    expect(getStreakBonus(STREAK_BONUS_THRESHOLD - 1)).toBe(1);
    expect(getStreakBonus(STREAK_BONUS_THRESHOLD)).toBe(STREAK_BONUS_MULTIPLIER);
  });

  it('clamps negative inputs and keeps XP finite', () => {
    const xp = calculateTaskXP({
      category: 'analysis',
      completionTimeMinutes: -5,
      completionStreak: -3,
    });

    expect(xp).toBe(Math.round(BASE_XP_BY_CATEGORY.analysis * SPEED_BONUS_MULTIPLIER));
    expect(Number.isFinite(xp)).toBe(true);
  });

  it('handles NaN and unknown legacy category payloads', () => {
    const nanInputXP = calculateTaskXP({
      category: 'docs',
      completionTimeMinutes: Number.NaN,
      completionStreak: Number.NaN,
    });
    expect(nanInputXP).toBe(BASE_XP_BY_CATEGORY.docs);

    const legacyCategory = 'legacy_wrapped_category' as unknown as TaskCategory;
    const legacyXP = calculateTaskXP({
      category: legacyCategory,
      completionTimeMinutes: 1,
      completionStreak: STREAK_BONUS_THRESHOLD,
    });

    expect(legacyXP).toBe(
      Math.round(
        BASE_XP_BY_CATEGORY.other * SPEED_BONUS_MULTIPLIER * STREAK_BONUS_MULTIPLIER
      )
    );
  });
});
