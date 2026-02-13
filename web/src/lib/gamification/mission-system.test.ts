import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MISSION_DEFINITIONS,
  checkAndRefreshMissions,
  checkMission,
  createDefaultMissions,
  toMissionConditionLabel,
  type MissionDefinition,
} from './mission-system';

describe('toMissionConditionLabel', () => {
  it('renders total_time conditions as readable Japanese text', () => {
    expect(toMissionConditionLabel('total_time:60')).toBe('60分間の作業を完了せよ');
  });

  it('renders task_count conditions with localized category names', () => {
    expect(toMissionConditionLabel('task_count:refactoring:4')).toBe(
      'リファクタリングを4件完遂せよ'
    );
    expect(toMissionConditionLabel('task_count:skill_creation:2')).toBe('スキル作成を2件完遂せよ');
    expect(toMissionConditionLabel('task_count:bug_fix:5')).toBe('バグ修正を5件完遂せよ');
  });

  it('falls back to a generic Japanese label when category is unknown', () => {
    expect(toMissionConditionLabel('task_count:unknown_category:3')).toBe('任務を3件完遂せよ');
  });
});

describe('mission generation policy', () => {
  it('generates only single task_count condition missions', () => {
    for (const definition of DEFAULT_MISSION_DEFINITIONS) {
      expect(definition.conditions).toHaveLength(1);
      expect(definition.conditions[0]?.type).toBe('task_count');
    }
  });

  it('does not generate total_time conditions in mission states', () => {
    const missions = createDefaultMissions();
    expect(missions.every((mission) => mission.conditions.length === 1)).toBe(true);
    expect(
      missions.some((mission) => mission.conditions.some((condition) => condition.startsWith('total_time:')))
    ).toBe(false);
  });
});

describe('mission reward balance', () => {
  it('keeps the full daily reward pool within economy budget caps', () => {
    const totals = DEFAULT_MISSION_DEFINITIONS.reduce(
      (acc, definition) => ({
        gold: acc.gold + definition.reward.gold,
        xp: acc.xp + definition.reward.xp,
      }),
      { gold: 0, xp: 0 }
    );

    expect(totals.gold).toBeLessThanOrEqual(450);
    expect(totals.xp).toBeLessThanOrEqual(900);
  });

  it('normalizes per-task reward efficiency for all task_count missions', () => {
    for (const definition of DEFAULT_MISSION_DEFINITIONS) {
      const condition = definition.conditions[0];
      expect(condition?.type).toBe('task_count');

      if (condition?.type !== 'task_count') {
        continue;
      }

      const goldPerTask = definition.reward.gold / condition.target;
      const xpPerTask = definition.reward.xp / condition.target;

      expect(goldPerTask).toBeGreaterThanOrEqual(8);
      expect(goldPerTask).toBeLessThanOrEqual(12);
      expect(xpPerTask).toBeGreaterThanOrEqual(20);
      expect(xpPerTask).toBeLessThanOrEqual(30);
    }
  });
});

describe('checkMission progress', () => {
  it('uses task count targets and ignores sub-10-minute tasks', () => {
    const definition: MissionDefinition = {
      id: 'spec_target_progress',
      title: '検証任務',
      conditions: [{ type: 'task_count', category: 'test', target: 8 }],
      reward: { xp: 1, gold: 1 },
    };

    const result = checkMission(definition, {
      tasks: [
        { category: 'test', durationMinutes: 10 },
        { category: 'test', durationMinutes: 12 },
        { category: 'test', durationMinutes: 5 },
      ],
      currentStreak: 0,
      bestStreak: 0,
    });

    expect(result.progress).toEqual({
      current: 2,
      target: 8,
    });
    expect(result.completed).toBe(false);
  });

  it('floors total_time progress and ignores tasks below minimum duration', () => {
    const definition: MissionDefinition = {
      id: 'spec_total_time_rounding',
      title: '時間検証任務',
      conditions: [{ type: 'total_time', targetMinutes: 21 }],
      reward: { xp: 1, gold: 1 },
    };

    const result = checkMission(definition, {
      tasks: [
        { category: 'analysis', durationMinutes: 9.9 },
        { category: 'analysis', durationMinutes: 10.4 },
        { category: 'test', durationMinutes: 10.4 },
      ],
      currentStreak: 0,
      bestStreak: 0,
    });

    expect(result.progress).toEqual({
      current: 20,
      target: 21,
    });
    expect(result.completed).toBe(false);
  });

  it('ignores invalid serialized conditions while evaluating valid ones', () => {
    const missionState = {
      id: 'legacy_invalid_conditions',
      title: '不正条件混在',
      conditions: ['task_count:test:4', 'task_count:unknown:2', 'streak:not-a-number'],
      claimed: false,
      reward: { xp: 10, gold: 10 },
      progress: { current: 0, target: 1 },
    };

    const result = checkMission(missionState, {
      tasks: [{ category: 'test', durationMinutes: 12 }],
      currentStreak: 0,
      bestStreak: 0,
    });

    expect(result.details).toHaveLength(1);
    expect(result.progress).toEqual({ current: 1, target: 4 });
    expect(result.completed).toBe(false);
  });
});

describe('checkAndRefreshMissions', () => {
  it('refreshes only at the 24-hour boundary and not before it', () => {
    const resetAt = '2026-02-08T00:00:00.000Z';
    const baseMissions = createDefaultMissions(
      { tasks: [], currentStreak: 0, bestStreak: 0 },
      { period: 'daily', resetAt }
    );

    const beforeBoundary = checkAndRefreshMissions(baseMissions, undefined, {
      now: new Date('2026-02-08T23:59:59.999Z'),
    });
    expect(beforeBoundary[0]).toBe(baseMissions[0]);

    const atBoundary = checkAndRefreshMissions(baseMissions, undefined, {
      now: new Date('2026-02-09T00:00:00.000Z'),
    });
    expect(atBoundary[0]).not.toBe(baseMissions[0]);
    expect(atBoundary.every((mission) => mission.resetAt === '2026-02-09T00:00:00.000Z')).toBe(true);
  });

  it('replaces claimed or completed missions while keeping active missions by id', () => {
    const oldResetAt = '2026-02-08T00:00:00.000Z';
    const history = {
      tasks: [{ category: 'analysis' as const, durationMinutes: 10 }],
      currentStreak: 0,
      bestStreak: 0,
    };
    const seeded = createDefaultMissions(history, { period: 'daily', resetAt: oldResetAt });
    const targetMissions = [
      { ...seeded[0], claimed: true },
      { ...seeded[1], progress: { current: seeded[1].progress.target, target: seeded[1].progress.target } },
      seeded[2],
    ];

    const refreshed = checkAndRefreshMissions(targetMissions, history, {
      now: new Date('2026-02-09T00:00:00.000Z'),
    });

    expect(refreshed[2]?.id).toBe(targetMissions[2]?.id);
    expect(refreshed[0]?.claimed).toBe(false);
    expect(refreshed[1]?.claimed).toBe(false);
    expect(new Set(refreshed.map((mission) => mission.id)).size).toBe(refreshed.length);
    expect(refreshed.every((mission) => mission.resetAt === '2026-02-09T00:00:00.000Z')).toBe(true);
  });

  it('backfills missing mission metadata without forcing full refresh', () => {
    const seedResetAt = '2026-02-09T00:30:00.000Z';
    const seeded = createDefaultMissions(
      { tasks: [], currentStreak: 0, bestStreak: 0 },
      { period: 'daily', resetAt: seedResetAt }
    );
    const legacy = seeded.map((mission, index) =>
      index === 1
        ? {
            ...mission,
            period: undefined,
            resetAt: undefined,
          }
        : mission
    );

    const now = new Date('2026-02-09T12:00:00.000Z');
    const refreshed = checkAndRefreshMissions(legacy, undefined, { now });

    expect(refreshed[0]).toBe(legacy[0]);
    expect(refreshed[1]).toMatchObject({
      id: legacy[1]?.id,
      period: 'daily',
      resetAt: '2026-02-09T12:00:00.000Z',
    });
  });

  it('creates default missions when mission list is empty', () => {
    const generated = checkAndRefreshMissions([], { tasks: [], currentStreak: 0, bestStreak: 0 }, {
      now: new Date('2026-02-09T09:15:00.000Z'),
    });

    expect(generated).toHaveLength(DEFAULT_MISSION_DEFINITIONS.length);
    expect(generated.every((mission) => mission.period === 'daily')).toBe(true);
    expect(generated.every((mission) => mission.resetAt === '2026-02-09T09:15:00.000Z')).toBe(true);
  });
});
