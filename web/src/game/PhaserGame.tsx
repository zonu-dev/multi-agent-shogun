import Phaser from 'phaser';
import { useEffect, useMemo, useRef } from 'react';
import type { BuildingLevel, BuildingType, Decoration, TaskUpdatePayload } from '@/types';
import { useGameStore } from '@/store/gameStore';
import { useTaskStore } from '@/store/taskStore';
import { shallow } from 'zustand/shallow';
import { createGameConfig } from './config';

const TASKS_UPDATED_EVENT = 'tasks:updated';
const TASKS_REQUEST_EVENT = 'tasks:request';
const BUILDING_LEVELS_UPDATED_EVENT = 'buildings:updated';
const BUILDING_LEVELS_REQUEST_EVENT = 'buildings:request';
const DECORATIONS_UPDATED_EVENT = 'decorations:updated';
const DECORATIONS_REQUEST_EVENT = 'decorations:request';
const BUILDING_TYPES: BuildingType[] = [
  'castle',
  'mansion',
  'inn',
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
];
type BuildingLevelPayload = Record<BuildingType, BuildingLevel>;
interface PlacedDecoration extends Decoration {
  position: {
    x: number;
    y: number;
  };
}
type DecorationPayload = PlacedDecoration[];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toBuildingLevel = (value: unknown): BuildingLevel => {
  const numeric = typeof value === 'number' ? Math.floor(value) : 1;
  if (numeric <= 1) {
    return 1;
  }
  if (numeric >= 5) {
    return 5;
  }
  return numeric as BuildingLevel;
};

const createDefaultBuildingLevels = (): BuildingLevelPayload => ({
  castle: 1,
  mansion: 1,
  inn: 1,
  dojo: 1,
  smithy: 1,
  training: 1,
  study: 1,
  healer: 1,
  watchtower: 1,
  scriptorium: 1,
});

const readBuildingLevelsFromState = (state: unknown): BuildingLevelPayload => {
  const defaultLevels = createDefaultBuildingLevels();
  if (!isRecord(state) || !isRecord(state.buildingLevels)) {
    return defaultLevels;
  }

  const levels = { ...defaultLevels };
  for (const type of BUILDING_TYPES) {
    levels[type] = toBuildingLevel(state.buildingLevels[type]);
  }

  return levels;
};

const isDecorationPayload = (value: unknown): value is PlacedDecoration => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    isRecord(value.position) &&
    typeof value.position.x === 'number' &&
    Number.isFinite(value.position.x) &&
    typeof value.position.y === 'number' &&
    Number.isFinite(value.position.y)
  );
};

const toDecorationLevel = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(1, Math.min(5, Math.floor(value)));
};

const toDecorationPassiveEffect = (value: unknown): Decoration['passiveEffect'] | null => {
  if (!isRecord(value)) {
    return null;
  }

  const effectType = value.type;
  const bonusPerLevel = value.bonusPerLevel;
  if (
    (effectType !== 'gold_bonus' &&
      effectType !== 'xp_bonus' &&
      effectType !== 'drop_rate_bonus') ||
    typeof bonusPerLevel !== 'number' ||
    !Number.isFinite(bonusPerLevel) ||
    bonusPerLevel <= 0
  ) {
    return null;
  }

  return {
    type: effectType,
    bonusPerLevel,
  };
};

const readDecorationsFromState = (state: unknown): DecorationPayload => {
  if (!isRecord(state) || !isRecord(state.gameState)) {
    return [];
  }

  const { gameState } = state;
  if (!Array.isArray(gameState.decorations)) {
    return [];
  }

  return gameState.decorations.filter(isDecorationPayload).map((decoration) => {
    const level = toDecorationLevel(decoration.level);
    const passiveEffect = toDecorationPassiveEffect(decoration.passiveEffect);

    return {
      id: decoration.id,
      type: decoration.type,
      ...(level !== null ? { level } : {}),
      ...(passiveEffect ? { passiveEffect } : {}),
      position: {
        x: Math.floor(decoration.position.x),
        y: Math.floor(decoration.position.y),
      },
    };
  });
};

const isTaskUpdatePayload = (value: unknown): value is TaskUpdatePayload => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.taskId === 'string' &&
    typeof value.assigneeId === 'string' &&
    typeof value.category === 'string' &&
    typeof value.status === 'string' &&
    typeof value.updatedAt === 'string'
  );
};

const readTasksFromState = (state: unknown): TaskUpdatePayload[] => {
  if (!isRecord(state)) {
    return [];
  }

  if (Array.isArray(state.tasks)) {
    return state.tasks.filter(isTaskUpdatePayload);
  }

  if (isRecord(state.tasks)) {
    return Object.values(state.tasks).filter(isTaskUpdatePayload);
  }

  return [];
};

const EMPTY_DECORATIONS: DecorationPayload = [];

export const PhaserGame = (): JSX.Element => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const taskSlice = useTaskStore((state) => state.tasks, shallow);
  const buildingLevelsSlice = useGameStore((state) => state.buildingLevels, shallow);
  const decorationsSlice = useGameStore(
    (state) => state.gameState?.decorations ?? EMPTY_DECORATIONS,
    shallow
  );

  const selectedTasks = useMemo<TaskUpdatePayload[]>(() => {
    return readTasksFromState({ tasks: taskSlice });
  }, [taskSlice]);
  const selectedBuildingLevels = useMemo<BuildingLevelPayload>(() => {
    return readBuildingLevelsFromState({ buildingLevels: buildingLevelsSlice });
  }, [buildingLevelsSlice]);
  const selectedDecorations = useMemo<DecorationPayload>(() => {
    return readDecorationsFromState({
      gameState: {
        decorations: decorationsSlice,
      },
    });
  }, [decorationsSlice]);

  const latestTasksRef = useRef<TaskUpdatePayload[]>(selectedTasks);
  const latestBuildingLevelsRef = useRef<BuildingLevelPayload>(selectedBuildingLevels);
  const latestDecorationsRef = useRef<DecorationPayload>(selectedDecorations);

  useEffect(() => {
    latestTasksRef.current = selectedTasks;
    latestBuildingLevelsRef.current = selectedBuildingLevels;
    latestDecorationsRef.current = selectedDecorations;
  }, [selectedBuildingLevels, selectedDecorations, selectedTasks]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) {
      return;
    }

    game.events.emit(TASKS_UPDATED_EVENT, selectedTasks);
  }, [selectedTasks]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) {
      return;
    }

    game.events.emit(BUILDING_LEVELS_UPDATED_EVENT, selectedBuildingLevels);
  }, [selectedBuildingLevels]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) {
      return;
    }

    game.events.emit(DECORATIONS_UPDATED_EVENT, selectedDecorations);
  }, [selectedDecorations]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const game = new Phaser.Game(createGameConfig('phaser-container'));
    gameRef.current = game;

    let disposed = false;

    const emitTasksUpdated = (tasks: TaskUpdatePayload[]): void => {
      if (disposed) {
        return;
      }
      game.events.emit(TASKS_UPDATED_EVENT, tasks);
    };

    const emitBuildingLevelsUpdated = (levels: BuildingLevelPayload): void => {
      if (disposed) {
        return;
      }
      game.events.emit(BUILDING_LEVELS_UPDATED_EVENT, levels);
    };
    const emitDecorationsUpdated = (decorations: DecorationPayload): void => {
      if (disposed) {
        return;
      }
      game.events.emit(DECORATIONS_UPDATED_EVENT, decorations);
    };

    const handleTasksRequest = (): void => {
      emitTasksUpdated(latestTasksRef.current);
    };

    const handleBuildingLevelsRequest = (): void => {
      emitBuildingLevelsUpdated(latestBuildingLevelsRef.current);
    };
    const handleDecorationsRequest = (): void => {
      emitDecorationsUpdated(latestDecorationsRef.current);
    };

    game.events.on(TASKS_REQUEST_EVENT, handleTasksRequest);
    game.events.on(BUILDING_LEVELS_REQUEST_EVENT, handleBuildingLevelsRequest);
    game.events.on(DECORATIONS_REQUEST_EVENT, handleDecorationsRequest);
    emitTasksUpdated(latestTasksRef.current);
    emitBuildingLevelsUpdated(latestBuildingLevelsRef.current);
    emitDecorationsUpdated(latestDecorationsRef.current);

    return () => {
      disposed = true;
      game.events.off(TASKS_REQUEST_EVENT, handleTasksRequest);
      game.events.off(BUILDING_LEVELS_REQUEST_EVENT, handleBuildingLevelsRequest);
      game.events.off(DECORATIONS_REQUEST_EVENT, handleDecorationsRequest);
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={containerRef} id="phaser-container" style={{ width: '100%', height: '100%' }} />;
};

export default PhaserGame;
