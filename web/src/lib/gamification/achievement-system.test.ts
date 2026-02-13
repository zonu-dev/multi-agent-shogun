import { describe, expect, it } from 'vitest';
import { ITEM_MASTER } from '../../data/item-master';
import type { ActivityLogEntry, BuildingType, GameState, Title } from '../../types/game';
import { checkAchievements, checkTitles, resolveEquippedTitle } from './achievement-system';

const createActivityLogEntries = (
  count: number,
  entry: Omit<ActivityLogEntry, 'id' | 'timestamp' | 'message'> & { message?: string }
): ActivityLogEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `log-${index + 1}`,
    timestamp: `2026-02-09T06:${String(index).padStart(2, '0')}:00`,
    message: entry.message ?? 'log',
    ...entry,
  }));

const createBaseState = (overrides: Partial<GameState> = {}): GameState => ({
  ashigaru: [],
  buildings: [
    { type: 'castle', level: 1, position: { x: 0, y: 0 } },
    { type: 'mansion', level: 1, position: { x: 1, y: 0 } },
    { type: 'inn', level: 1, position: { x: 2, y: 0 } },
    { type: 'dojo', level: 1, position: { x: 3, y: 0 } },
    { type: 'smithy', level: 1, position: { x: 4, y: 0 } },
    { type: 'training', level: 1, position: { x: 5, y: 0 } },
    { type: 'study', level: 1, position: { x: 6, y: 0 } },
    { type: 'healer', level: 1, position: { x: 7, y: 0 } },
    { type: 'watchtower', level: 1, position: { x: 8, y: 0 } },
    { type: 'scriptorium', level: 1, position: { x: 9, y: 0 } },
  ],
  town: { level: 1, xp: 0, gold: 100 },
  economy: { gold: 100 },
  inventory: [],
  decorations: [],
  missions: [],
  activityLog: [],
  achievements: [],
  titles: [],
  equippedTitle: null,
  dailyRecords: [],
  materialCollection: [],
  ...overrides,
});

const MATERIAL_IDS = ITEM_MASTER.filter((item) => item.itemType === 'material').map((item) => item.id);

const SPECIALIZED_BUILDINGS: BuildingType[] = [
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
];

describe('achievement-system', () => {
  it('increments task-category achievements and emits milestone unlocks', () => {
    const state = createBaseState({
      activityLog: createActivityLogEntries(10, {
        type: 'work_complete',
        taskCategory: 'analysis',
      }),
      achievements: [
        {
          id: 'task_mastery_analysis',
          category: 'task_mastery',
          name: '軍議武勲章',
          description: '軍議の完了数で段階達成（10/30/60）',
          thresholds: [10, 30, 60],
          currentValue: 9,
        },
      ],
    });

    const result = checkAchievements(state);
    const analysisAchievement = result.achievements.find(
      (achievement) => achievement.id === 'task_mastery_analysis'
    );

    expect(analysisAchievement?.currentValue).toBe(10);
    expect(result.unlocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task_mastery_analysis',
          reachedThreshold: 10,
        }),
      ])
    );
  });

  it('evaluates material collection rate at min, threshold, and max levels', () => {
    expect(MATERIAL_IDS.length).toBeGreaterThan(0);

    const minState = createBaseState();
    const minResult = checkAchievements(minState);
    const minAchievement = minResult.achievements.find(
      (achievement) => achievement.id === 'material_collection_record'
    );
    expect(minAchievement?.currentValue).toBe(0);

    const thresholdCount = Math.ceil((30 * MATERIAL_IDS.length) / 100);
    const thresholdState = createBaseState({
      materialCollection: MATERIAL_IDS.slice(0, thresholdCount).map((itemId) => ({
        itemId,
        count: 1,
      })),
    });
    const thresholdResult = checkAchievements(thresholdState);
    const thresholdAchievement = thresholdResult.achievements.find(
      (achievement) => achievement.id === 'material_collection_record'
    );
    expect((thresholdAchievement?.currentValue ?? 0) >= 30).toBe(true);
    expect(thresholdResult.unlocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'material_collection_record',
          reachedThreshold: 30,
        }),
      ])
    );

    const maxState = createBaseState({
      inventory: MATERIAL_IDS.map((itemId) => ({ itemId, quantity: 1 })),
    });
    const maxResult = checkAchievements(maxState);
    const maxAchievement = maxResult.achievements.find(
      (achievement) => achievement.id === 'material_collection_record'
    );
    expect(maxAchievement?.currentValue).toBe(100);
    expect(maxResult.unlocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'material_collection_record',
          reachedThreshold: 100,
        }),
      ])
    );
  });

  it('evaluates building-threshold achievements at boundary values', () => {
    const lowState = createBaseState({
      buildings: createBaseState().buildings.map((building, index) => ({
        ...building,
        level: index < 2 ? 3 : 1,
      })),
    });
    const lowResult = checkAchievements(lowState);
    const lowRecord = lowResult.achievements.find(
      (achievement) => achievement.id === 'castle_town_development_record'
    );
    expect(lowRecord?.currentValue).toBe(2);

    const boundaryState = createBaseState({
      buildings: createBaseState().buildings.map((building, index) => ({
        ...building,
        level: index < 3 ? 3 : 1,
      })),
    });
    const boundaryResult = checkAchievements(boundaryState);
    const boundaryRecord = boundaryResult.achievements.find(
      (achievement) => achievement.id === 'castle_town_development_record'
    );
    expect(boundaryRecord?.currentValue).toBe(3);
    expect(boundaryResult.unlocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'castle_town_development_record',
          reachedThreshold: 3,
        }),
      ])
    );

    const maxState = createBaseState({
      buildings: createBaseState().buildings.map((building) => ({
        ...building,
        level: 3,
      })),
    });
    const maxResult = checkAchievements(maxState);
    const maxRecord = maxResult.achievements.find(
      (achievement) => achievement.id === 'castle_town_development_record'
    );
    expect(maxRecord?.currentValue).toBe(10);
    expect(maxResult.unlocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'castle_town_development_record',
          reachedThreshold: 10,
        }),
      ])
    );
  });

  it('preserves unknown achievements and titles in output', () => {
    const legacyAchievementId = 'legacy_achievement_custom';
    const legacyTitleId = 'legacy_title_custom';
    const state = createBaseState({
      achievements: [
        {
          id: legacyAchievementId,
          category: 'legacy',
          name: '旧勲章',
          description: '旧ロジック由来',
          thresholds: [10, 10, 5],
          currentValue: 7,
          unlockedAt: '2026-02-09T00:00:00.000Z',
        },
      ],
      titles: [
        {
          id: legacyTitleId,
          name: '旧称号',
          description: '旧ロジック由来',
          condition: 'legacy:1',
          unlockedAt: '2026-02-09T00:00:00.000Z',
        },
      ],
    });

    const achievementResult = checkAchievements(state);
    const legacyAchievement = achievementResult.achievements.find(
      (achievement) => achievement.id === legacyAchievementId
    );
    expect(legacyAchievement).toMatchObject({
      id: legacyAchievementId,
      thresholds: [5, 10],
      currentValue: 7,
      unlockedAt: '2026-02-09T00:00:00.000Z',
    });

    const titleResult = checkTitles(state);
    expect(titleResult.titles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: legacyTitleId,
          unlockedAt: '2026-02-09T00:00:00.000Z',
        }),
      ])
    );
  });

  it('unlocks mission-completion titles at configured thresholds', () => {
    const state = createBaseState({
      activityLog: createActivityLogEntries(5, {
        type: 'mission_complete',
      }),
    });

    const result = checkTitles(state);
    const apprentice = result.titles.find((title) => title.id === 'edict_apprentice');

    expect(apprentice?.unlockedAt).toBeDefined();
    expect(result.unlocked.map((title) => title.id)).toContain('edict_apprentice');
  });

  it('evaluates martial titles at under-threshold and threshold values', () => {
    const scenarios = [
      { id: 'foot_captain', threshold: 10, name: '一番槍' },
      { id: 'samurai_commander', threshold: 50, name: '先陣大将' },
      { id: 'warlord', threshold: 100, name: '鬼武者' },
      { id: 'peerless_warrior', threshold: 200, name: '軍神' },
    ] as const;

    for (const scenario of scenarios) {
      const belowState = createBaseState({
        activityLog: createActivityLogEntries(scenario.threshold - 1, {
          type: 'work_complete',
          taskCategory: 'analysis',
        }),
      });
      const belowResult = checkTitles(belowState);
      expect(belowResult.unlocked.map((title) => title.id)).not.toContain(scenario.id);

      const thresholdState = createBaseState({
        activityLog: createActivityLogEntries(scenario.threshold, {
          type: 'work_complete',
          taskCategory: 'analysis',
        }),
      });
      const thresholdResult = checkTitles(thresholdState);
      expect(thresholdResult.unlocked.map((title) => title.id)).toContain(scenario.id);
      expect(thresholdResult.titles.find((title) => title.id === scenario.id)).toMatchObject({
        id: scenario.id,
        name: scenario.name,
        category: 'martial',
      });
    }
  });

  it('evaluates gold titles at under-threshold and threshold values', () => {
    const scenarios = [
      { id: 'gold_apprentice', threshold: 500, name: '銭勘定' },
      { id: 'gold_merchant', threshold: 5000, name: '千両箱番' },
      { id: 'gold_tycoon', threshold: 20000, name: '天下の台所' },
    ] as const;

    for (const scenario of scenarios) {
      const belowState = createBaseState({
        town: { ...createBaseState().town, gold: scenario.threshold - 1 },
        economy: { gold: scenario.threshold - 1 },
      });
      const belowResult = checkTitles(belowState);
      expect(belowResult.unlocked.map((title) => title.id)).not.toContain(scenario.id);

      const thresholdState = createBaseState({
        town: { ...createBaseState().town, gold: scenario.threshold },
        economy: { gold: scenario.threshold },
      });
      const thresholdResult = checkTitles(thresholdState);
      expect(thresholdResult.unlocked.map((title) => title.id)).toContain(scenario.id);
      expect(thresholdResult.titles.find((title) => title.id === scenario.id)).toMatchObject({
        id: scenario.id,
        name: scenario.name,
        category: 'magistrate',
      });
    }
  });

  it('evaluates material titles at under-threshold and threshold values', () => {
    expect(MATERIAL_IDS.length).toBeGreaterThan(0);

    const scenarios = [
      { id: 'material_apprentice', threshold: 30, name: '拾い屋' },
      { id: 'material_magistrate', threshold: 60, name: '目利き衆' },
      { id: 'material_master', threshold: 100, name: '南蛮渡来通' },
    ] as const;

    for (const scenario of scenarios) {
      const requiredCount = Math.ceil((scenario.threshold * MATERIAL_IDS.length) / 100);
      const belowCount = Math.max(0, requiredCount - 1);

      const belowState = createBaseState({
        materialCollection: MATERIAL_IDS.slice(0, belowCount).map((itemId) => ({
          itemId,
          count: 1,
        })),
      });
      const belowResult = checkTitles(belowState);
      expect(belowResult.unlocked.map((title) => title.id)).not.toContain(scenario.id);

      const thresholdState = createBaseState({
        materialCollection: MATERIAL_IDS.slice(0, requiredCount).map((itemId) => ({
          itemId,
          count: 1,
        })),
      });
      const thresholdResult = checkTitles(thresholdState);
      expect(thresholdResult.unlocked.map((title) => title.id)).toContain(scenario.id);
      expect(thresholdResult.titles.find((title) => title.id === scenario.id)).toMatchObject({
        id: scenario.id,
        name: scenario.name,
        category: 'collection',
      });
    }
  });

  it('evaluates decoration titles at under-threshold and threshold values', () => {
    const scenarios = [
      { id: 'deco_apprentice', threshold: 3, name: '石灯籠守' },
      { id: 'deco_magistrate', threshold: 7, name: '枯山水棟梁' },
      { id: 'deco_master', threshold: 15, name: '借景の宗匠' },
    ] as const;

    for (const scenario of scenarios) {
      const belowState = createBaseState({
        decorations: Array.from({ length: scenario.threshold - 1 }, (_, index) => ({
          id: `deco-below-${scenario.id}-${index}`,
          type: 'garden',
          position: { x: index, y: 0 },
        })),
      });
      const belowResult = checkTitles(belowState);
      expect(belowResult.unlocked.map((title) => title.id)).not.toContain(scenario.id);

      const thresholdState = createBaseState({
        decorations: Array.from({ length: scenario.threshold }, (_, index) => ({
          id: `deco-threshold-${scenario.id}-${index}`,
          type: 'garden',
          position: { x: index, y: 1 },
        })),
      });
      const thresholdResult = checkTitles(thresholdState);
      expect(thresholdResult.unlocked.map((title) => title.id)).toContain(scenario.id);
      expect(thresholdResult.titles.find((title) => title.id === scenario.id)).toMatchObject({
        id: scenario.id,
        name: scenario.name,
        category: 'collection',
      });
    }
  });

  it('counts only placed decorations for decoration-placed thresholds', () => {
    const unplacedState = createBaseState({
      decorations: Array.from({ length: 5 }, (_, index) => ({
        id: `deco-unplaced-${index}`,
        type: 'garden',
      })),
    });
    const unplacedResult = checkTitles(unplacedState);
    expect(unplacedResult.unlocked.map((title) => title.id)).not.toContain('deco_apprentice');

    const mixedState = createBaseState({
      decorations: [
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `deco-inventory-${index}`,
          type: 'garden',
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `deco-placed-${index}`,
          type: 'garden',
          position: { x: index, y: 2 },
        })),
      ],
    });
    const mixedResult = checkTitles(mixedState);
    expect(mixedResult.unlocked.map((title) => title.id)).toContain('deco_apprentice');
  });

  it('evaluates xp titles at under-threshold and threshold values', () => {
    const scenarios = [
      { id: 'xp_apprentice', threshold: 1000, name: '木刀小姓' },
      { id: 'xp_master', threshold: 5000, name: '兵法師範' },
      { id: 'xp_sage', threshold: 20000, name: '剣聖' },
    ] as const;

    for (const scenario of scenarios) {
      const belowState = createBaseState({
        town: { ...createBaseState().town, xp: scenario.threshold - 1 },
      });
      const belowResult = checkTitles(belowState);
      expect(belowResult.unlocked.map((title) => title.id)).not.toContain(scenario.id);

      const thresholdState = createBaseState({
        town: { ...createBaseState().town, xp: scenario.threshold },
      });
      const thresholdResult = checkTitles(thresholdState);
      expect(thresholdResult.unlocked.map((title) => title.id)).toContain(scenario.id);
      expect(thresholdResult.titles.find((title) => title.id === scenario.id)).toMatchObject({
        id: scenario.id,
        name: scenario.name,
        category: 'collection',
      });
    }
  });

  it('unlocks specialized/all-building titles at configured thresholds', () => {
    const specializedLevels: GameState['buildings'] = createBaseState().buildings.map((building) => ({
      ...building,
      level: SPECIALIZED_BUILDINGS.includes(building.type) ? (3 as const) : (1 as const),
    }));
    const specializedState = createBaseState({
      buildings: specializedLevels,
    });
    const specializedResult = checkTitles(specializedState);
    expect(specializedResult.unlocked.map((title) => title.id)).toContain('castle_town_magistrate');

    const maxState = createBaseState({
      buildings: createBaseState().buildings.map((building) => ({
        ...building,
        level: 5,
      })),
    });
    const maxResult = checkTitles(maxState);
    expect(maxResult.unlocked.map((title) => title.id)).toContain('tenka_fushin');
  });

  it('resolveEquippedTitle keeps valid equips and falls back safely', () => {
    const titles: Title[] = [
      {
        id: 'fushin_apprentice',
        name: '縄張り番',
        description: '建物を3棟以上Lv3へ育て上げた者',
        condition: 'building_count_at_or_above_level:all:3:3',
      },
      {
        id: 'edict_apprentice',
        name: '朱印書記',
        description: '御触書を累計5件成就せし者',
        condition: 'mission_claimed_count:5',
        unlockedAt: '2026-02-09T00:00:00.000Z',
      },
      {
        id: 'castle_town_magistrate',
        name: '石垣積みの鬼',
        description: '専門7棟をすべてLv3以上へ整えし者',
        condition: 'building_count_at_or_above_level:specialized:3:7',
        unlockedAt: '2026-02-09T01:00:00.000Z',
      },
    ];

    expect(resolveEquippedTitle('castle_town_magistrate', titles)).toBe('castle_town_magistrate');
    expect(resolveEquippedTitle('missing_title', titles)).toBe('edict_apprentice');
    expect(
      resolveEquippedTitle('missing_title', [
        {
          id: 'locked_only',
          name: '未解放称号',
          description: '未解放',
          condition: 'none',
        },
      ])
    ).toBeNull();
  });
});
