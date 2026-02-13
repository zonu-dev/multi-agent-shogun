import Phaser from 'phaser';

import {
  TASK_TO_BUILDING_MAP,
  type AshigaruState,
  type BuildingType,
  type Position,
  type TaskCategory,
} from '@/types';
import type { TaskUpdatePayload } from '@/types/server';

import { AshigaruSprite, type CharacterRuntimeState } from './AshigaruSprite';
import { ASHIGARU_PROFILES } from './CharacterConfig';

interface IsoOptions {
  tileWidth: number;
  tileHeight: number;
  origin: Position;
}

export interface TaskStoreSnapshot {
  tasks: TaskUpdatePayload[];
}

export interface TaskStoreLike {
  getState: () => TaskStoreSnapshot;
  subscribe?: (listener: () => void) => () => void;
}

export interface CharacterManagerOptions {
  buildingIsoPositions?: Partial<Record<BuildingType, Position>>;
  taskStore?: TaskStoreLike;
  iso?: Partial<IsoOptions>;
}

type TaskStatus = TaskUpdatePayload['status'];

const DEFAULT_ISO: IsoOptions = {
  tileWidth: 64,
  tileHeight: 32,
  origin: { x: 440, y: 250 },
};

const DEFAULT_BUILDING_ISO_POSITIONS: Record<BuildingType, Position> = {
  castle: { x: 0, y: -4 },
  mansion: { x: -3, y: -2 },
  inn: { x: -6, y: 4 },
  dojo: { x: 4, y: 2 },
  smithy: { x: 6, y: 1 },
  training: { x: 6, y: 5 },
  study: { x: 2, y: 6 },
  healer: { x: -2, y: 7 },
  watchtower: { x: -5, y: 6 },
  scriptorium: { x: 8, y: 6 },
};

export const TASK_CATEGORY_TO_BUILDING: Record<TaskCategory, BuildingType> = TASK_TO_BUILDING_MAP;

const STATUS_TO_RUNTIME: Record<TaskStatus, CharacterRuntimeState['status']> = {
  assigned: 'assigned',
  in_progress: 'working',
  done: 'done',
  failed: 'failed',
  blocked: 'blocked',
};

export class CharacterManager {
  private readonly scene: Phaser.Scene;
  private readonly iso: IsoOptions;
  private readonly sprites = new Map<string, AshigaruSprite>();
  private readonly buildingPositions = new Map<BuildingType, Position>();
  private readonly movementTokens = new Map<string, number>();

  private taskStore?: TaskStoreLike;
  private unsubscribeFromStore?: () => void;

  constructor(scene: Phaser.Scene, options: CharacterManagerOptions = {}) {
    this.scene = scene;
    this.iso = {
      tileWidth: options.iso?.tileWidth ?? DEFAULT_ISO.tileWidth,
      tileHeight: options.iso?.tileHeight ?? DEFAULT_ISO.tileHeight,
      origin: options.iso?.origin ?? DEFAULT_ISO.origin,
    };

    const mergedIsoPositions: Record<BuildingType, Position> = {
      ...DEFAULT_BUILDING_ISO_POSITIONS,
      ...(options.buildingIsoPositions ?? {}),
    };

    Object.entries(mergedIsoPositions).forEach(([buildingType, isoPos]) => {
      this.buildingPositions.set(buildingType as BuildingType, this.isoToScreen(isoPos));
    });

    this.createAshigaruSprites();

    if (options.taskStore) {
      this.attachTaskStore(options.taskStore);
    }
  }

  getCharacter(id: string): AshigaruSprite | undefined {
    return this.sprites.get(id);
  }

  getCharacters(): AshigaruSprite[] {
    return [...this.sprites.values()];
  }

  attachTaskStore(taskStore: TaskStoreLike): void {
    this.unsubscribeFromStore?.();
    this.taskStore = taskStore;

    if (taskStore.subscribe) {
      this.unsubscribeFromStore = taskStore.subscribe(() => {
        this.syncFromTaskStore();
      });
    }

    this.syncFromTaskStore();
  }

  async attachTaskStoreFromModule(modulePath = '@/store'): Promise<boolean> {
    try {
      const resolvedPath = modulePath;
      const storeModule = (await import(/* @vite-ignore */ resolvedPath)) as {
        useTaskStore?: TaskStoreLike;
      };
      if (!storeModule.useTaskStore?.getState) {
        return false;
      }
      // Zustand参照: useTaskStore.getState()
      storeModule.useTaskStore.getState();
      this.attachTaskStore(storeModule.useTaskStore);
      return true;
    } catch {
      return false;
    }
  }

  applyTaskUpdate(task: TaskUpdatePayload): void {
    const sprite = this.sprites.get(task.assigneeId);
    if (!sprite) {
      return;
    }

    const destination = this.getTaskDestination(task.category);
    const movementToken = this.bumpMovementToken(task.assigneeId);
    const duration = this.computeDuration({ x: sprite.x, y: sprite.y }, destination);

    sprite.setTaskContext(task.category, task.taskId);

    const runtimeStatus = STATUS_TO_RUNTIME[task.status];
    if (task.status === 'assigned') {
      sprite.applyVisualState('assigned');
      void sprite.moveToPosition(destination, { duration, ease: 'Quadratic.InOut' }).then(() => {
        if (!this.isMovementTokenCurrent(task.assigneeId, movementToken)) {
          return;
        }
        sprite.applyVisualState('working');
      });
      return;
    }

    if (task.status === 'in_progress') {
      sprite.applyVisualState('assigned');
      void sprite.moveToPosition(destination, { duration, ease: 'Quadratic.InOut' }).then(() => {
        if (!this.isMovementTokenCurrent(task.assigneeId, movementToken)) {
          return;
        }
        sprite.applyVisualState('working');
      });
      return;
    }

    if (task.status === 'done') {
      sprite.applyVisualState(runtimeStatus);
      this.scene.time.delayedCall(900, () => {
        if (!this.isMovementTokenCurrent(task.assigneeId, movementToken)) {
          return;
        }
        const innPosition = this.getTaskDestination('idle');
        const returnDuration = this.computeDuration({ x: sprite.x, y: sprite.y }, innPosition);
        void sprite.moveToPosition(innPosition, {
          duration: returnDuration,
          ease: 'Quadratic.InOut',
        });
        sprite.setTaskContext('idle', null);
        sprite.applyVisualState('idle');
      });
      return;
    }

    if (task.status === 'failed' || task.status === 'blocked') {
      sprite.applyVisualState(runtimeStatus);
      void sprite.moveToPosition(destination, { duration, ease: 'Quadratic.InOut' });
      return;
    }

    sprite.applyVisualState('idle');
  }

  syncFromTaskStore(): void {
    if (!this.taskStore) {
      return;
    }

    const snapshot = this.taskStore.getState();
    if (!snapshot || !Array.isArray(snapshot.tasks)) {
      return;
    }

    const latestTaskByWorker = new Map<string, TaskUpdatePayload>();

    snapshot.tasks
      .slice()
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .forEach((task) => {
        latestTaskByWorker.set(task.assigneeId, task);
      });

    for (const [workerId, sprite] of this.sprites.entries()) {
      const task = latestTaskByWorker.get(workerId);
      if (task) {
        this.applyTaskUpdate(task);
        continue;
      }
      sprite.setTaskContext('idle', null);
      sprite.applyVisualState('idle');
    }
  }

  destroy(): void {
    this.unsubscribeFromStore?.();
    this.unsubscribeFromStore = undefined;
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
  }

  private createAshigaruSprites(): void {
    const inn = this.getTaskDestination('idle');
    ASHIGARU_PROFILES.forEach((profile, index) => {
      const spawnOffsetX = (index % 4) * 28 - 42;
      const spawnOffsetY = Math.floor(index / 4) * 28 + 8;
      const x = inn.x + spawnOffsetX;
      const y = inn.y + spawnOffsetY;
      const state: AshigaruState = {
        id: profile.id,
        name: profile.name,
        status: 'idle',
        taskId: null,
        taskCategory: 'idle',
        position: { x, y },
      };
      const sprite = new AshigaruSprite(this.scene, state);
      this.sprites.set(profile.id, sprite);
    });
  }

  private getTaskDestination(taskCategory: TaskCategory): Position {
    const building = TASK_CATEGORY_TO_BUILDING[taskCategory] ?? 'inn';
    return this.buildingPositions.get(building) ?? this.isoToScreen({ x: 0, y: 0 });
  }

  private isoToScreen(iso: Position): Position {
    const halfTileWidth = this.iso.tileWidth / 2;
    const halfTileHeight = this.iso.tileHeight / 2;
    return {
      x: this.iso.origin.x + (iso.x - iso.y) * halfTileWidth,
      y: this.iso.origin.y + (iso.x + iso.y) * halfTileHeight,
    };
  }

  private computeDuration(from: Position, to: Position): number {
    const distance = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
    return Phaser.Math.Clamp(Math.round(distance * 6), 1000, 2000);
  }

  private bumpMovementToken(workerId: string): number {
    const nextToken = (this.movementTokens.get(workerId) ?? 0) + 1;
    this.movementTokens.set(workerId, nextToken);
    return nextToken;
  }

  private isMovementTokenCurrent(workerId: string, token: number): boolean {
    return this.movementTokens.get(workerId) === token;
  }
}
