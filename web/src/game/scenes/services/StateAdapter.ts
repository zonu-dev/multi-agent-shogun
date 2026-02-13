import {
  TASK_TO_BUILDING_MAP,
  type BuildingType,
  type GameState,
  type TaskCategory,
  type TaskUpdatePayload,
} from '@/types';

export type CharacterDisplayStatus =
  | 'idle'
  | 'assigned'
  | 'working'
  | 'done'
  | 'failed'
  | 'blocked';

export interface WorkerDisplayState {
  workerId: string;
  status: CharacterDisplayStatus;
  category: TaskUpdatePayload['category'] | null;
}

export type BuildingPopupStatus = '待機' | '作業中' | '障害中';

export const WORKER_IDS = [
  'ashigaru1',
  'ashigaru2',
  'ashigaru3',
  'ashigaru4',
  'ashigaru5',
  'ashigaru6',
  'ashigaru7',
  'ashigaru8',
] as const;

export const DEFAULT_WORKER_NAMES: Readonly<Record<string, string>> = {
  ashigaru1: '足軽壱',
  ashigaru2: '足軽弐',
  ashigaru3: '足軽参',
  ashigaru4: '足軽四',
  ashigaru5: '足軽五',
  ashigaru6: '足軽六',
  ashigaru7: '足軽七',
  ashigaru8: '足軽八',
};

export const COMMANDER_LABELS = {
  shogun: '将軍',
  karo: '家老',
} as const;

const LEGACY_TASK_CATEGORY_ALIASES: Readonly<Record<string, TaskCategory>> = {
  research: 'analysis',
};

const toTaskCategory = (category: string): TaskCategory | null => {
  const normalized = category.trim().toLowerCase();
  if (normalized.length < 1) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(TASK_TO_BUILDING_MAP, normalized)) {
    return normalized as TaskCategory;
  }

  return LEGACY_TASK_CATEGORY_ALIASES[normalized] ?? null;
};

export const toWorkerIndex = (workerId: string): number => {
  const raw = workerId.replace(/\D+/g, '');
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const toLatestTaskByWorkerMap = (
  tasks: TaskUpdatePayload[]
): Map<string, TaskUpdatePayload> => {
  const latestByWorker = new Map<string, TaskUpdatePayload>();
  tasks
    .slice()
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .forEach((task) => {
      latestByWorker.set(task.assigneeId, task);
    });

  return latestByWorker;
};

export const toDisplayStates = (tasks: TaskUpdatePayload[]): WorkerDisplayState[] => {
  const latestByWorker = toLatestTaskByWorkerMap(tasks);

  return [...WORKER_IDS].map((workerId) => {
    const task = latestByWorker.get(workerId);
    if (!task) {
      return {
        workerId,
        status: 'idle',
        category: null,
      };
    }

    if (task.status === 'assigned') {
      return {
        workerId,
        status: 'assigned',
        category: task.category,
      };
    }

    if (task.status === 'in_progress') {
      return {
        workerId,
        status: 'working',
        category: task.category,
      };
    }

    return {
      workerId,
      status: task.status,
      category: task.category,
    };
  });
};

export const requiresBuildingAssignment = (status: CharacterDisplayStatus): boolean =>
  status === 'assigned' || status === 'working' || status === 'failed' || status === 'blocked';

export const isInnWaitingStatus = (status: CharacterDisplayStatus): boolean =>
  status === 'idle' || status === 'done';

export const isActiveWorkingStatus = (status: CharacterDisplayStatus): boolean =>
  status === 'assigned' || status === 'working';

export const resolveStrictBuildingFromCategory = (
  category: TaskUpdatePayload['category'] | null
): BuildingType | null => {
  if (!category) {
    return TASK_TO_BUILDING_MAP.idle;
  }

  const taskCategory = toTaskCategory(String(category));
  if (!taskCategory) {
    return TASK_TO_BUILDING_MAP.idle;
  }

  return TASK_TO_BUILDING_MAP[taskCategory];
};

export const pickWorkingBuilding = (
  occupiedBuildings: Set<BuildingType>,
  workingBuildingTypes: readonly BuildingType[]
): BuildingType => {
  const available = workingBuildingTypes.filter((type) => !occupiedBuildings.has(type));
  if (available.length > 0) {
    return available[0] ?? 'inn';
  }

  return workingBuildingTypes[0] ?? 'inn';
};

export const syncBuildingAssignments = (
  displayStates: WorkerDisplayState[],
  workerBuildingAssignments: Map<string, BuildingType>,
  workingBuildingTypes: readonly BuildingType[]
): void => {
  for (const state of displayStates) {
    if (!requiresBuildingAssignment(state.status)) {
      workerBuildingAssignments.delete(state.workerId);
    }
  }

  const occupiedBuildings = new Set<BuildingType>();
  for (const state of displayStates) {
    if (!requiresBuildingAssignment(state.status)) {
      continue;
    }

    const strictBuilding = resolveStrictBuildingFromCategory(state.category);
    if (strictBuilding) {
      workerBuildingAssignments.set(state.workerId, strictBuilding);
      occupiedBuildings.add(strictBuilding);
      continue;
    }

    const existing = workerBuildingAssignments.get(state.workerId);
    if (existing && !occupiedBuildings.has(existing)) {
      occupiedBuildings.add(existing);
      continue;
    }

    const assignedBuilding = pickWorkingBuilding(occupiedBuildings, workingBuildingTypes);
    workerBuildingAssignments.set(state.workerId, assignedBuilding);
    occupiedBuildings.add(assignedBuilding);
  }
};

export const getWorkerIdsAssignedToBuilding = (
  type: BuildingType,
  workerBuildingAssignments: ReadonlyMap<string, BuildingType>
): string[] =>
  [...workerBuildingAssignments.entries()]
    .filter(([, assignedBuilding]) => assignedBuilding === type)
    .map(([workerId]) => workerId)
    .sort((left, right) => toWorkerIndex(left) - toWorkerIndex(right));

export const resolveWorkerName = (workerId: string, gameState: GameState | null): string => {
  const worker = gameState?.ashigaru.find((entry) => entry.id === workerId);
  const resolvedName = worker?.name?.trim();

  if (resolvedName && resolvedName.length > 0) {
    return resolvedName;
  }

  return DEFAULT_WORKER_NAMES[workerId] ?? workerId;
};

export const getAssignedWorkerIdsForBuilding = (
  type: BuildingType,
  workerBuildingAssignments: ReadonlyMap<string, BuildingType>,
  workerStatuses: ReadonlyMap<string, CharacterDisplayStatus>
): string[] => {
  const workerIds = [...workerBuildingAssignments.entries()]
    .filter(([, assignedBuilding]) => assignedBuilding === type)
    .map(([workerId]) => workerId);

  if (type === 'inn') {
    for (const [workerId, status] of workerStatuses.entries()) {
      if (isInnWaitingStatus(status)) {
        workerIds.push(workerId);
      }
    }
  }

  const uniqueWorkerIds = [...new Set(workerIds)].sort(
    (left, right) => toWorkerIndex(left) - toWorkerIndex(right)
  );

  return uniqueWorkerIds;
};

export const getAssignedWorkersForBuilding = (
  type: BuildingType,
  workerBuildingAssignments: ReadonlyMap<string, BuildingType>,
  workerStatuses: ReadonlyMap<string, CharacterDisplayStatus>,
  gameState: GameState | null
): string[] => {
  if (type === 'castle') {
    return [COMMANDER_LABELS.shogun];
  }

  if (type === 'mansion') {
    return [COMMANDER_LABELS.karo];
  }

  return getAssignedWorkerIdsForBuilding(type, workerBuildingAssignments, workerStatuses).map(
    (workerId) => resolveWorkerName(workerId, gameState)
  );
};

export const resolveTaskAssignedAt = (task: TaskUpdatePayload | undefined): string | null => {
  const rawAssignedAt = (task as (TaskUpdatePayload & { assignedAt?: unknown }) | undefined)
    ?.assignedAt;
  if (typeof rawAssignedAt !== 'string') {
    return null;
  }

  const assignedAt = rawAssignedAt.trim();
  return assignedAt.length > 0 ? assignedAt : null;
};

export const resolveElapsedMinutes = (assignedAt: string, nowTimestamp: number): number | null => {
  const assignedTimestamp = Date.parse(assignedAt);
  if (!Number.isFinite(assignedTimestamp)) {
    return null;
  }

  const elapsedMillis = Math.max(0, nowTimestamp - assignedTimestamp);
  return Math.floor(elapsedMillis / 60000);
};

export const resolveWorkerLabelWithElapsed = (
  workerId: string,
  task: TaskUpdatePayload | undefined,
  nowTimestamp: number,
  workerStatuses: ReadonlyMap<string, CharacterDisplayStatus>,
  gameState: GameState | null
): string => {
  const name = resolveWorkerName(workerId, gameState);
  const status = workerStatuses.get(workerId);
  if (!status || !requiresBuildingAssignment(status)) {
    return name;
  }

  const assignedAt = resolveTaskAssignedAt(task);
  if (!assignedAt) {
    return name;
  }

  const elapsedMinutes = resolveElapsedMinutes(assignedAt, nowTimestamp);
  if (elapsedMinutes === null) {
    return name;
  }

  return `${name}(${elapsedMinutes}分)`;
};

export const getAssignedWorkersWithElapsedForBuilding = (
  type: BuildingType,
  workerBuildingAssignments: ReadonlyMap<string, BuildingType>,
  workerStatuses: ReadonlyMap<string, CharacterDisplayStatus>,
  latestTasks: TaskUpdatePayload[],
  gameState: GameState | null
): string[] => {
  if (type === 'castle' || type === 'mansion') {
    return getAssignedWorkersForBuilding(
      type,
      workerBuildingAssignments,
      workerStatuses,
      gameState
    );
  }

  const latestByWorker = toLatestTaskByWorkerMap(latestTasks);
  const nowTimestamp = Date.now();

  return getAssignedWorkerIdsForBuilding(type, workerBuildingAssignments, workerStatuses).map(
    (workerId) =>
      resolveWorkerLabelWithElapsed(
        workerId,
        latestByWorker.get(workerId),
        nowTimestamp,
        workerStatuses,
        gameState
      )
  );
};

export const resolveBuildingPopupStatus = (
  type: BuildingType,
  workerBuildingAssignments: ReadonlyMap<string, BuildingType>,
  workerStatuses: ReadonlyMap<string, CharacterDisplayStatus>
): BuildingPopupStatus => {
  let hasFailure = false;
  let hasWorking = false;

  for (const [workerId, assignedBuilding] of workerBuildingAssignments.entries()) {
    if (assignedBuilding !== type) {
      continue;
    }

    const status = workerStatuses.get(workerId);
    if (status === 'failed' || status === 'blocked') {
      hasFailure = true;
      continue;
    }

    if (status === 'assigned' || status === 'working') {
      hasWorking = true;
    }
  }

  if (hasFailure) {
    return '障害中';
  }

  if (hasWorking) {
    return '作業中';
  }

  return '待機';
};
