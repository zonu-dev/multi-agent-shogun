import type { TaskCategory } from '../../types/game';

export const BASE_XP_BY_CATEGORY: Record<TaskCategory, number> = {
  new_implementation: 100,
  refactoring: 80,
  skill_creation: 90,
  analysis: 60,
  bug_fix: 70,
  docs: 65,
  test: 50,
  idle: 0,
  other: 40,
};

export const SPEED_BONUS_THRESHOLD_MINUTES = 2;
export const SPEED_BONUS_MULTIPLIER = 1.5;

export const STREAK_BONUS_THRESHOLD = 3;
export const STREAK_BONUS_MULTIPLIER = 1.2;

export interface XPCalculationInput {
  category: TaskCategory;
  completionTimeMinutes: number;
  completionStreak: number;
}

export const getSpeedBonus = (completionTimeMinutes: number): number =>
  completionTimeMinutes < SPEED_BONUS_THRESHOLD_MINUTES ? SPEED_BONUS_MULTIPLIER : 1;

export const getStreakBonus = (completionStreak: number): number =>
  completionStreak >= STREAK_BONUS_THRESHOLD ? STREAK_BONUS_MULTIPLIER : 1;

export const calculateTaskXP = ({
  category,
  completionTimeMinutes,
  completionStreak,
}: XPCalculationInput): number => {
  const safeMinutes = Math.max(0, completionTimeMinutes);
  const safeStreak = Math.max(0, completionStreak);
  const baseXP = BASE_XP_BY_CATEGORY[category] ?? BASE_XP_BY_CATEGORY.other;

  return Math.round(baseXP * getSpeedBonus(safeMinutes) * getStreakBonus(safeStreak));
};
