import type { Mission, TaskCategory } from '../../types/game';

export type MissionCondition =
  | {
      type: 'task_count';
      category: TaskCategory;
      target: number;
    }
  | {
      type: 'total_time';
      targetMinutes: number;
    }
  | {
      type: 'streak';
      target: number;
    };

export interface MissionDefinition {
  id: string;
  title: string;
  conditions: MissionCondition[];
  reward: Mission['reward'];
}

export interface MissionHistoryTask {
  category: TaskCategory;
  durationMinutes: number;
}

export interface MissionHistory {
  tasks: MissionHistoryTask[];
  currentStreak: number;
  bestStreak?: number;
}

export interface MissionConditionProgress {
  condition: MissionCondition;
  current: number;
  target: number;
  completed: boolean;
}

export interface MissionCheckResult {
  completed: boolean;
  progress: Mission['progress'];
  details: MissionConditionProgress[];
}

interface ToMissionStateOptions {
  resetAt?: string;
  period?: NonNullable<Mission['period']>;
}

interface RefreshMissionOptions {
  now?: Date;
  period?: NonNullable<Mission['period']>;
}

const DAILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MISSION_REFRESH_PERIOD: NonNullable<Mission['period']> = 'daily';
const MIN_MISSION_TASK_DURATION_MINUTES = 10;

const isTaskCategory = (value: string): value is TaskCategory =>
  [
    'new_implementation',
    'refactoring',
    'skill_creation',
    'analysis',
    'bug_fix',
    'docs',
    'test',
    'idle',
    'other',
  ].includes(value);

const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  new_implementation: '新規実装',
  refactoring: 'リファクタリング',
  skill_creation: 'スキル作成',
  analysis: '分析',
  bug_fix: 'バグ修正',
  docs: 'ドキュメント作成',
  test: 'テスト',
  idle: '待機',
  other: 'その他作業',
};

const getTaskCategoryLabel = (category: string): string => {
  if (isTaskCategory(category)) {
    return TASK_CATEGORY_LABELS[category];
  }

  return '任務';
};

const toSafeDurationMinutes = (durationMinutes: number): number => {
  if (!Number.isFinite(durationMinutes)) {
    return 0;
  }

  return Math.max(0, durationMinutes);
};

const isMissionEligibleTask = (task: MissionHistoryTask): boolean =>
  toSafeDurationMinutes(task.durationMinutes) >= MIN_MISSION_TASK_DURATION_MINUTES;

const buildTaskCountReward = (
  target: number,
  rates: { xpPerTask: number; goldPerTask: number }
): Mission['reward'] => ({
  xp: Math.max(1, Math.round(target * rates.xpPerTask)),
  gold: Math.max(1, Math.round(target * rates.goldPerTask)),
});

export const serializeMissionCondition = (condition: MissionCondition): string => {
  if (condition.type === 'task_count') {
    return `task_count:${condition.category}:${condition.target}`;
  }

  if (condition.type === 'total_time') {
    return `total_time:${condition.targetMinutes}`;
  }

  return `streak:${condition.target}`;
};

export const parseMissionCondition = (value: string): MissionCondition | null => {
  const [kind, arg1, arg2] = value.split(':');

  if (kind === 'task_count' && arg1 && arg2 && isTaskCategory(arg1)) {
    const target = Number(arg2);
    if (!Number.isNaN(target) && target > 0) {
      return { type: 'task_count', category: arg1, target };
    }
  }

  if (kind === 'total_time' && arg1) {
    const targetMinutes = Number(arg1);
    if (!Number.isNaN(targetMinutes) && targetMinutes > 0) {
      return { type: 'total_time', targetMinutes };
    }
  }

  if (kind === 'streak' && arg1) {
    const target = Number(arg1);
    if (!Number.isNaN(target) && target > 0) {
      return { type: 'streak', target };
    }
  }

  return null;
};

export const toMissionConditionLabel = (value: string): string => {
  const parsed = parseMissionCondition(value);
  if (parsed !== null) {
    if (parsed.type === 'total_time') {
      return `${parsed.targetMinutes}分間の作業を完了せよ`;
    }

    if (parsed.type === 'task_count') {
      return `${getTaskCategoryLabel(parsed.category)}を${parsed.target}件完遂せよ`;
    }

    return `${parsed.target}タスク完遂せよ`;
  }

  const [kind, arg1, arg2] = value.split(':');
  if (kind === 'total_time' && arg1) {
    const targetMinutes = Number(arg1);
    if (Number.isFinite(targetMinutes) && targetMinutes > 0) {
      return `${targetMinutes}分間の作業を完了せよ`;
    }
  }

  if (kind === 'task_count' && arg1 && arg2) {
    const target = Number(arg2);
    if (Number.isFinite(target) && target > 0) {
      return `${getTaskCategoryLabel(arg1)}を${target}件完遂せよ`;
    }
  }

  if (kind === 'streak' && arg1) {
    const target = Number(arg1);
    if (Number.isFinite(target) && target > 0) {
      return `${target}タスク完遂せよ`;
    }
  }

  return value;
};

export const DEFAULT_MISSION_DEFINITIONS: readonly MissionDefinition[] = [
  {
    id: 'mission_001',
    title: '三連斬り',
    conditions: [{ type: 'task_count', category: 'analysis', target: 3 }],
    reward: buildTaskCountReward(3, { xpPerTask: 22, goldPerTask: 9.5 }),
  },
  {
    id: 'mission_002',
    title: '蟲掃討',
    conditions: [{ type: 'task_count', category: 'bug_fix', target: 3 }],
    reward: buildTaskCountReward(3, { xpPerTask: 23, goldPerTask: 9.0 }),
  },
  {
    id: 'mission_003',
    title: '一刻の鍛錬',
    conditions: [{ type: 'task_count', category: 'docs', target: 4 }],
    reward: buildTaskCountReward(4, { xpPerTask: 21, goldPerTask: 10.0 }),
  },
  {
    id: 'mission_004',
    title: '築城検地',
    conditions: [{ type: 'task_count', category: 'new_implementation', target: 4 }],
    reward: buildTaskCountReward(4, { xpPerTask: 22, goldPerTask: 10.75 }),
  },
  {
    id: 'mission_005',
    title: '鍛冶奉行',
    conditions: [{ type: 'task_count', category: 'refactoring', target: 3 }],
    reward: buildTaskCountReward(3, { xpPerTask: 21, goldPerTask: 10.0 }),
  },
  {
    id: 'mission_006',
    title: '軍学修行',
    conditions: [{ type: 'task_count', category: 'analysis', target: 4 }],
    reward: buildTaskCountReward(4, { xpPerTask: 22, goldPerTask: 9.0 }),
  },
  {
    id: 'mission_007',
    title: '秘伝之技',
    conditions: [{ type: 'task_count', category: 'skill_creation', target: 2 }],
    reward: buildTaskCountReward(2, { xpPerTask: 24, goldPerTask: 11.0 }),
  },
  {
    id: 'mission_008',
    title: '物見番',
    conditions: [{ type: 'task_count', category: 'test', target: 5 }],
    reward: buildTaskCountReward(5, { xpPerTask: 21, goldPerTask: 11.0 }),
  },
  {
    id: 'mission_009',
    title: '守城之陣',
    conditions: [{ type: 'task_count', category: 'bug_fix', target: 4 }],
    reward: buildTaskCountReward(4, { xpPerTask: 23, goldPerTask: 10.0 }),
  },
  {
    id: 'mission_010',
    title: '天下布武',
    conditions: [{ type: 'task_count', category: 'new_implementation', target: 6 }],
    reward: buildTaskCountReward(6, { xpPerTask: 24, goldPerTask: 11.0 }),
  },
] as const;

const evaluateCondition = (
  condition: MissionCondition,
  history: MissionHistory
): MissionConditionProgress => {
  if (condition.type === 'task_count') {
    const current = history.tasks.filter(
      (task) => task.category === condition.category && isMissionEligibleTask(task)
    ).length;
    return {
      condition,
      current,
      target: condition.target,
      completed: current >= condition.target,
    };
  }

  if (condition.type === 'total_time') {
    const current = Math.floor(
      history.tasks.reduce(
        (sum, task) => sum + (isMissionEligibleTask(task) ? toSafeDurationMinutes(task.durationMinutes) : 0),
        0
      )
    );
    return {
      condition,
      current,
      target: condition.targetMinutes,
      completed: current >= condition.targetMinutes,
    };
  }

  const current = Math.max(0, history.currentStreak);
  return {
    condition,
    current,
    target: condition.target,
    completed: current >= condition.target,
  };
};

const parseIsoTimestamp = (value: string | undefined): number | null => {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isMissionCompleted = (mission: Mission): boolean => {
  const progressTarget = Math.max(1, mission.progress?.target ?? 0);
  const progressCurrent = mission.progress?.current ?? 0;
  return progressCurrent >= progressTarget;
};

const shouldRunDailyRefresh = (
  missions: readonly Mission[],
  nowMs: number,
  period: NonNullable<Mission['period']>
): boolean => {
  let latestRefreshMs: number | null = null;

  for (const mission of missions) {
    if (mission.period !== undefined && mission.period !== period) {
      continue;
    }

    const parsedRefreshAt = parseIsoTimestamp(mission.resetAt);
    if (parsedRefreshAt === null) {
      continue;
    }

    latestRefreshMs =
      latestRefreshMs === null ? parsedRefreshAt : Math.max(latestRefreshMs, parsedRefreshAt);
  }

  if (latestRefreshMs === null) {
    return true;
  }

  return nowMs - latestRefreshMs >= DAILY_REFRESH_INTERVAL_MS;
};

const normalizeConditions = (mission: MissionDefinition | Mission): MissionCondition[] => {
  if ('progress' in mission) {
    return mission.conditions
      .map((condition) => parseMissionCondition(condition))
      .filter((condition): condition is MissionCondition => condition !== null);
  }

  return mission.conditions;
};

export const checkMission = (
  mission: MissionDefinition | Mission,
  history: MissionHistory
): MissionCheckResult => {
  const conditions = normalizeConditions(mission);

  const details = conditions.map((condition) => evaluateCondition(condition, history));
  const completed = details.length > 0 && details.every((detail) => detail.completed);
  const progressCurrentRaw = details.reduce(
    (sum, detail) => sum + Math.min(Math.max(0, detail.current), Math.max(0, detail.target)),
    0
  );
  const progressTarget = Math.max(
    1,
    details.reduce((sum, detail) => sum + Math.max(0, detail.target), 0)
  );

  return {
    completed,
    progress: {
      current: Math.min(progressTarget, progressCurrentRaw),
      target: progressTarget,
    },
    details,
  };
};

export const claimReward = (mission: MissionDefinition | Mission): Mission['reward'] => ({
  xp: mission.reward.xp,
  gold: mission.reward.gold,
});

export const toMissionState = (
  definition: MissionDefinition,
  history: MissionHistory = { tasks: [], currentStreak: 0, bestStreak: 0 },
  options: ToMissionStateOptions = {}
): Mission => {
  const result = checkMission(definition, history);
  return {
    id: definition.id,
    title: definition.title,
    conditions: definition.conditions.map((condition) => serializeMissionCondition(condition)),
    claimed: false,
    reward: claimReward(definition),
    progress: result.progress,
    ...(options.resetAt ? { resetAt: options.resetAt } : {}),
    ...(options.period ? { period: options.period } : {}),
  };
};

export const createDefaultMissions = (
  history: MissionHistory = { tasks: [], currentStreak: 0, bestStreak: 0 },
  options: ToMissionStateOptions = {}
): Mission[] =>
  DEFAULT_MISSION_DEFINITIONS.map((definition) => toMissionState(definition, history, options));

export const checkAndRefreshMissions = (
  missions: readonly Mission[],
  history: MissionHistory = { tasks: [], currentStreak: 0, bestStreak: 0 },
  options: RefreshMissionOptions = {}
): Mission[] => {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    return [...missions];
  }

  const refreshPeriod = options.period ?? DEFAULT_MISSION_REFRESH_PERIOD;
  const refreshedAt = now.toISOString();

  if (missions.length === 0) {
    return createDefaultMissions(history, {
      period: refreshPeriod,
      resetAt: refreshedAt,
    });
  }

  const shouldRefresh = shouldRunDailyRefresh(missions, nowMs, refreshPeriod);

  if (!shouldRefresh) {
    let didBackfillMetadata = false;
    const nextMissions = missions.map((mission) => {
      if (mission.period !== undefined && mission.resetAt !== undefined) {
        return mission;
      }

      didBackfillMetadata = true;
      return {
        ...mission,
        period: mission.period ?? refreshPeriod,
        resetAt: mission.resetAt ?? refreshedAt,
      };
    });

    return didBackfillMetadata ? nextMissions : [...missions];
  }

  const shouldReplaceByIndex = missions.map(
    (mission) => mission.claimed === true || isMissionCompleted(mission)
  );
  const reservedMissionIds = new Set<string>();
  for (let i = 0; i < missions.length; i += 1) {
    if (!shouldReplaceByIndex[i]) {
      reservedMissionIds.add(missions[i].id);
    }
  }

  return missions.map((mission, index) => {
    if (!shouldReplaceByIndex[index]) {
      return {
        ...mission,
        period: mission.period ?? refreshPeriod,
        resetAt: refreshedAt,
      };
    }

    const replacementDefinition =
      DEFAULT_MISSION_DEFINITIONS.find((definition) => !reservedMissionIds.has(definition.id)) ??
      DEFAULT_MISSION_DEFINITIONS.find((definition) => definition.id === mission.id) ??
      DEFAULT_MISSION_DEFINITIONS[0];

    reservedMissionIds.add(replacementDefinition.id);
    return toMissionState(replacementDefinition, history, {
      period: refreshPeriod,
      resetAt: refreshedAt,
    });
  });
};
