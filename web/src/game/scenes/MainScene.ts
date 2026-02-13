import Phaser from 'phaser';
import type { BuildingLevel, BuildingType, Decoration, TaskUpdatePayload } from '@/types';
import { useGameStore } from '@/store/gameStore';
import type { Building, BuildingClickPayload } from '../objects/buildings/Building';
import { BUILDING_CONFIGS } from '../objects/buildings/BuildingConfig';
import { CharacterEffects } from '../objects/characters/CharacterEffects';
import { createBuilding } from '../objects/buildings/BuildingFactory';
import { isoToCart, TILE_HEIGHT, TILE_WIDTH, tileToScreen } from '../utils/iso';
import {
  GROUND_TEXTURE_KEY,
  ROAD_TEXTURE_KEY,
  generateCharacterTexture,
} from '../utils/placeholders';
import {
  buildRoadPath as buildRoadPathTiles,
  createBlockedTilesFromPlacements,
  findAStarTilePath as findAStarPath,
  isTileInsideMap as isTileInsideMapFromService,
  resolveNearestDecorationTile as resolveNearestDecorationTileFromService,
  resolveNearestWalkableTile as resolveNearestWalkableTileFromService,
  toTileKey as toTileKeyFromService,
  type BuildingPlacement,
  type GridTile,
} from './services/BuildingPlacement';
import { PopupManager, type PopupThemeTokens } from './services/PopupManager';
import { SceneApiService } from './services/SceneApiService';
import {
  getAssignedWorkersForBuilding as getAssignedWorkersForBuildingFromState,
  getAssignedWorkersWithElapsedForBuilding as getAssignedWorkersWithElapsedForBuildingFromState,
  getWorkerIdsAssignedToBuilding as getWorkerIdsAssignedToBuildingFromState,
  isActiveWorkingStatus as isActiveWorkingStatusFromState,
  isInnWaitingStatus as isInnWaitingStatusFromState,
  pickWorkingBuilding as pickWorkingBuildingFromState,
  requiresBuildingAssignment as requiresBuildingAssignmentFromState,
  resolveBuildingPopupStatus as resolveBuildingPopupStatusFromState,
  resolveStrictBuildingFromCategory as resolveStrictBuildingFromCategoryFromState,
  syncBuildingAssignments as syncBuildingAssignmentsFromState,
  toDisplayStates as toDisplayStatesFromState,
  toWorkerIndex,
  type BuildingPopupStatus,
  type CharacterDisplayStatus,
  type WorkerDisplayState,
} from './services/StateAdapter';

export const MAIN_SCENE_KEY = 'MainScene';

const MAP_WIDTH = 16;
const MAP_HEIGHT = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const TASKS_UPDATED_EVENT = 'tasks:updated';
const TASKS_REQUEST_EVENT = 'tasks:request';
const BUILDING_LEVELS_UPDATED_EVENT = 'buildings:updated';
const BUILDING_LEVELS_REQUEST_EVENT = 'buildings:request';
const DECORATIONS_UPDATED_EVENT = 'decorations:updated';
const DECORATIONS_REQUEST_EVENT = 'decorations:request';
const BUILDING_CLICKED_EVENT = 'building:clicked';
const DECORATION_CLICKED_EVENT = 'decoration:clicked';
const DECORATION_PLACEMENT_START_EVENT = 'shogun:decoration-placement:start';
const DECORATION_PLACEMENT_COMMIT_EVENT = 'shogun:decoration-placement:commit';
const DECORATION_PLACEMENT_CANCEL_EVENT = 'shogun:decoration-placement:cancel';
const BUILDING_PLACEMENT_START_EVENT = 'shogun:building-placement:start';
const BUILDING_PLACEMENT_COMMIT_EVENT = 'shogun:building-placement:commit';
const BUILDING_PLACEMENT_CANCEL_EVENT = 'shogun:building-placement:cancel';
const GROUND_TILE_DEPTH = 0;
const ROAD_TILE_DEPTH = 1;
const BUILDING_PLACEMENT_TILE_OVERLAY_DEPTH = 2;
const BUILDING_DEPTH_OFFSET = 10;
const DECORATION_DEPTH_OFFSET = 120;
const DECORATION_GUIDE_VALID_COLOR = 0x22c55e;
const DECORATION_GUIDE_INVALID_COLOR = 0xef4444;
const DECORATION_GUIDE_FILL_ALPHA = 0.32;
const DECORATION_GUIDE_STROKE_ALPHA = 0.85;
const BUILDING_PLACEMENT_TILE_VALID_COLOR = 0x22c55e;
const BUILDING_PLACEMENT_TILE_INVALID_COLOR = 0x0f172a;
const BUILDING_PLACEMENT_TILE_VALID_ALPHA = 0.2;
const BUILDING_PLACEMENT_TILE_VALID_HOVER_ALPHA = 0.32;
const BUILDING_PLACEMENT_TILE_INVALID_ALPHA = 0.14;
const BUILDING_PLACEMENT_TILE_VALID_STROKE_COLOR = 0x86efac;
const BUILDING_PLACEMENT_TILE_INVALID_STROKE_COLOR = 0x64748b;
const DECORATION_PLACEMENT_NOTICE_DEPTH = 12_000;
const DECORATION_PLACEMENT_NOTICE_DURATION_MS = 1_600;
const BUILDING_PLACEMENT_STATUS_BAR_DEPTH = DECORATION_PLACEMENT_NOTICE_DEPTH + 18;
const BUILDING_PLACEMENT_STATUS_BAR_HEIGHT = 30;
const BUILDING_PLACEMENT_STATUS_BAR_MESSAGE =
  '建物移動中 - クリックで配置 / Escでキャンセル / 右クリックで中止';
const BUILDING_PLACEMENT_FEEDBACK_TEMPLATE = '%BUILDING%の移動モードへ入った。配置先をクリックされよ。';
const DECORATION_SHADOW_CENTER_Y = 12;
const DECORATION_CONTAINER_Y_OFFSET = -DECORATION_SHADOW_CENTER_Y;
const CAMERA_BOUNDS = { x: -300, y: -120, width: 2200, height: 1800 } as const;

const CHARACTER_COLORS = [
  '#60A5FA',
  '#34D399',
  '#F472B6',
  '#F59E0B',
  '#A78BFA',
  '#38BDF8',
  '#FB7185',
  '#FACC15',
];

const BUILDING_LABELS: Record<BuildingType, string> = {
  castle: '天守',
  mansion: '屋敷',
  inn: '宿屋',
  dojo: '剣術道場',
  smithy: '鍛冶屋',
  training: '修練場',
  study: '書院',
  healer: '薬師',
  watchtower: '物見櫓',
  scriptorium: '写本所',
};

const normalizeHexColor = (value: string): string | null => {
  const normalized = value.trim();
  const match = normalized.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) {
    return null;
  }

  const rawHex = match[1];
  if (rawHex.length === 3) {
    const expanded = rawHex
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('')
      .toLowerCase();
    return `#${expanded}`;
  }

  return `#${rawHex.toLowerCase()}`;
};

const toColorNumberFromHex = (hex: string): number => Number.parseInt(hex.slice(1), 16);

interface DecorationVisualMeta {
  emoji: string;
  badgeColor: number;
}

interface DecorationPlacementStartDetail {
  decorationType?: string;
}

type BuildingPlacementMode = 'move';

interface BuildingPlacementStartDetail {
  buildingId?: string;
  mode?: BuildingPlacementMode;
}

interface PlacedDecoration extends Decoration {
  position: {
    x: number;
    y: number;
  };
}

interface DecorationClickDetail {
  id: string;
  type: string;
  level?: number;
  passiveEffect?: {
    type: 'gold_bonus' | 'xp_bonus' | 'drop_rate_bonus';
    bonusPerLevel: number;
  };
  position: {
    x: number;
    y: number;
  };
}

interface DecorationPlacementPreview {
  tile: GridTile;
  canPlace: boolean;
  failureReason: string | null;
}

interface BuildingPlacementPreview {
  origin: GridTile;
  width: number;
  height: number;
  canPlace: boolean;
  failureReason: string | null;
}

interface UiLockStyleSnapshot {
  pointerEvents: string;
  opacity: string;
  filter: string;
}

type CharacterManagerAdapter = {
  handleTasksUpdated: (tasks: TaskUpdatePayload[]) => void;
  destroy: () => void;
};

type BuildingLevelPayload = Record<BuildingType, BuildingLevel>;

const BUILDING_LAYOUT: BuildingPlacement[] = [
  { type: 'castle', tileX: 7, tileY: 7, width: 2, height: 2 },
  { type: 'mansion', tileX: 0, tileY: 3, width: 1, height: 1 },
  { type: 'inn', tileX: 2, tileY: 9, width: 1, height: 1 },
  { type: 'dojo', tileX: 12, tileY: 0, width: 1, height: 1 },
  { type: 'smithy', tileX: 13, tileY: 9, width: 1, height: 1 },
  { type: 'training', tileX: 15, tileY: 4, width: 1, height: 1 },
  { type: 'study', tileX: 8, tileY: 12, width: 1, height: 1 },
  { type: 'healer', tileX: 5, tileY: 2, width: 1, height: 1 },
  { type: 'watchtower', tileX: 4, tileY: 15, width: 1, height: 1 },
  { type: 'scriptorium', tileX: 12, tileY: 15, width: 1, height: 1 },
];

const DECORATION_VISUALS: Record<string, DecorationVisualMeta> = {
  maneki_neko: {
    emoji: '🐈',
    badgeColor: 0xf59e0b,
  },
  komainu: {
    emoji: '🦁',
    badgeColor: 0x3b82f6,
  },
  sakura_tree: {
    emoji: '🌸',
    badgeColor: 0xf472b6,
  },
  ishidoro: {
    emoji: '🏮',
    badgeColor: 0xf59e0b,
  },
  stone_lantern: {
    emoji: '🏮',
    badgeColor: 0xf59e0b,
  },
  market_stall: {
    emoji: '🏪',
    badgeColor: 0x38bdf8,
  },
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

const normalizeBuildingLevel = (value: unknown): BuildingLevel => {
  const numeric = typeof value === 'number' ? Math.floor(value) : 1;
  if (numeric <= 1) {
    return 1;
  }
  if (numeric >= 5) {
    return 5;
  }
  return numeric as BuildingLevel;
};

const toBuildingType = (value: unknown): BuildingType | null =>
  typeof value === 'string' && value in BUILDING_CONFIGS ? (value as BuildingType) : null;

const resolveConfiguredBuildingMaxLevel = (type: BuildingType): BuildingLevel | null => {
  const maxLevel = BUILDING_CONFIGS[type]?.maxLevel;
  if (typeof maxLevel !== 'number' || !Number.isFinite(maxLevel)) {
    return null;
  }

  return normalizeBuildingLevel(maxLevel);
};

const isUpgradeCostBuildingType = (type: BuildingType): boolean => {
  const maxLevel = resolveConfiguredBuildingMaxLevel(type);
  return maxLevel !== null && maxLevel > 1;
};

const resolveUpgradeMaxLevel = (type: BuildingType): BuildingLevel => {
  return resolveConfiguredBuildingMaxLevel(type) ?? 1;
};

const BUILDING_TILE_VISUAL_COLORS: Record<BuildingType, number> = {
  castle: 0xfbbf24,
  mansion: 0xf59e0b,
  inn: 0x22c55e,
  dojo: 0x3b82f6,
  smithy: 0xf97316,
  training: 0x8b5cf6,
  study: 0x06b6d4,
  healer: 0xec4899,
  watchtower: 0x64748b,
  scriptorium: 0x6366f1,
};

export class MainScene extends Phaser.Scene {
  private readonly mapOrigin = new Phaser.Math.Vector2(580, 120);

  private readonly buildingAnchors = new Map<BuildingType, Phaser.Math.Vector2>();
  private readonly buildings = new Map<BuildingType, Building>();
  private buildingLevels: BuildingLevelPayload = createDefaultBuildingLevels();
  private obstacleBuildingPlacementCache: BuildingPlacement[] | null = null;
  private readonly obstacleBuildingPlacementByType = new Map<BuildingType, BuildingPlacement>();
  private obstacleBuildingPlacementCacheBuildingsRef: unknown = null;
  private obstacleBuildingPlacementCacheLevelSignature = '';
  private readonly buildingTileVisuals = new Map<BuildingType, Phaser.GameObjects.Graphics>();
  private roadTileContainer: Phaser.GameObjects.Container | null = null;
  private readonly decorationSprites = new Map<string, Phaser.GameObjects.Container>();
  private readonly decorationRenderSignatures = new Map<string, string>();
  private decorationPlacementGuide: Phaser.GameObjects.Graphics | null = null;
  private buildingPlacementGuide: Phaser.GameObjects.Graphics | null = null;
  private buildingPlacementTileOverlay: Phaser.GameObjects.Graphics | null = null;
  private decorationPlacementNoticeText: Phaser.GameObjects.Text | null = null;
  private decorationPlacementNoticeTimer: Phaser.Time.TimerEvent | null = null;
  private buildingPlacementStatusBar: Phaser.GameObjects.Container | null = null;
  private buildingPlacementStatusBarBackground: Phaser.GameObjects.Rectangle | null = null;
  private buildingPlacementStatusBarText: Phaser.GameObjects.Text | null = null;
  private readonly nonPlacementUiStyleSnapshots = new Map<HTMLElement, UiLockStyleSnapshot>();
  private latestDecorations: PlacedDecoration[] = [];
  private pendingDecorationPlacementType: string | null = null;
  private pendingBuildingPlacementType: BuildingType | null = null;
  private lastBuildingPlacementSignature = '';

  private readonly placeholderCharacters = new Map<string, Phaser.GameObjects.Image>();
  private readonly characterEffectAnchors = new Map<string, Phaser.GameObjects.Container>();
  private readonly characterEffects = new Map<string, CharacterEffects>();

  private characterManager: CharacterManagerAdapter | null = null;

  private latestTasks: TaskUpdatePayload[] = [];

  private hasHydratedInitialPositions = false;

  private readonly workerStatuses = new Map<string, CharacterDisplayStatus>();

  private readonly workerBuildingAssignments = new Map<string, BuildingType>();

  private readonly characterTweens = new Map<string, Phaser.Tweens.BaseTween>();
  private readonly buildingFailureTweens = new Map<BuildingType, Phaser.Tweens.Tween>();
  private readonly workingBuildingTypes: readonly BuildingType[];
  private readonly sceneApiService: SceneApiService;
  private readonly popupManager: PopupManager;

  private isDragging = false;

  private dragStartPointer = new Phaser.Math.Vector2();

  private dragStartCamera = new Phaser.Math.Vector2();
  private readonly handleDecorationPlacementStartEvent = (event: Event): void => {
    const detail = (event as CustomEvent<DecorationPlacementStartDetail>).detail;
    const decorationType = detail?.decorationType?.trim();
    if (!decorationType) {
      return;
    }

    this.pendingDecorationPlacementType = decorationType;
    this.pendingBuildingPlacementType = null;
    this.isDragging = false;
    this.disableBuildingPlacementMode();
    this.clearDecorationPlacementNotice();
    this.updateDecorationPlacementGuide(this.input.activePointer);
    this.closeBuildingPopup();
  };
  private readonly handleBuildingPlacementStartEvent = (event: Event): void => {
    const detail = (event as CustomEvent<BuildingPlacementStartDetail>).detail;
    const buildingType = toBuildingType(detail?.buildingId);
    if (buildingType === null || detail?.mode !== 'move') {
      return;
    }

    this.pendingBuildingPlacementType = buildingType;
    this.pendingDecorationPlacementType = null;
    this.isDragging = false;
    this.clearDecorationPlacementNotice();
    this.enableBuildingPlacementMode(buildingType);
    this.clearDecorationPlacementGuide();
    this.updateBuildingPlacementGuide(this.input.activePointer);
    this.closeBuildingPopup();
  };
  private readonly handleInputWheel = (
    _pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number
  ): void => {
    const camera = this.cameras.main;
    const nextZoom = Phaser.Math.Clamp(camera.zoom - deltaY * 0.001, MIN_ZOOM, MAX_ZOOM);
    camera.setZoom(nextZoom);
  };
  private readonly handleInputPointerDown = (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[] | undefined
  ): void => {
    if (this.handlePopupPointerDown(pointer)) {
      return;
    }

    if (this.pendingBuildingPlacementType !== null) {
      if (pointer.rightButtonDown()) {
        this.cancelBuildingPlacement('移動を取り止めた。');
        return;
      }

      if (!pointer.leftButtonDown()) {
        return;
      }

      this.commitBuildingPlacement(pointer);
      return;
    }

    if (this.pendingDecorationPlacementType !== null) {
      if (pointer.rightButtonDown()) {
        this.cancelDecorationPlacement('配置を取り止めた。');
        return;
      }

      if (!pointer.leftButtonDown()) {
        return;
      }

      this.commitDecorationPlacement(pointer);
      return;
    }

    if (!pointer.leftButtonDown()) {
      return;
    }

    const clickedDecoration = this.resolveDecorationAtPointer(pointer);
    if (clickedDecoration) {
      this.handleDecorationClick(clickedDecoration);
      return;
    }

    if (this.isPointerDownOnBuilding(gameObjects)) {
      this.isDragging = false;
      return;
    }

    if (!this.isPointerInsideBuildingPopup(pointer)) {
      this.isDragging = true;
      this.dragStartPointer.set(pointer.x, pointer.y);
      this.dragStartCamera.set(this.cameras.main.scrollX, this.cameras.main.scrollY);
    }
  };
  private readonly handleInputPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (this.pendingBuildingPlacementType !== null) {
      this.updateBuildingPlacementGuide(pointer);
      return;
    }

    if (this.pendingDecorationPlacementType !== null) {
      this.updateDecorationPlacementGuide(pointer);
    }
  };
  private readonly handleInputPointerUp = (): void => {
    this.isDragging = false;
  };
  private readonly handleInputPointerOut = (): void => {
    this.isDragging = false;
    if (this.pendingBuildingPlacementType !== null) {
      this.clearBuildingPlacementGuide();
      this.renderBuildingPlacementTileOverlay(null);
      return;
    }

    this.clearDecorationPlacementGuide();
  };
  private readonly handleEscKeyDown = (event: KeyboardEvent): void => {
    if (this.pendingBuildingPlacementType !== null) {
      event.preventDefault();
      this.cancelBuildingPlacement('移動を取り止めた。');
      return;
    }

    if (this.pendingDecorationPlacementType !== null) {
      event.preventDefault();
      this.cancelDecorationPlacement('配置を取り止めた。');
    }
  };

  constructor() {
    super({ key: MAIN_SCENE_KEY });

    this.workingBuildingTypes = BUILDING_LAYOUT.map((placement) => placement.type).filter(
      (type) => type !== 'castle'
    );

    this.sceneApiService = new SceneApiService({
      resolveUpgradeMaxLevel,
      isUpgradeCostBuildingType,
      normalizeBuildingLevel,
      buildingLabels: BUILDING_LABELS,
      applyBuildingUpgradeLevel: (type, level) => {
        this.applyBuildingUpgradeLevel(type, level);
      },
    });

    this.popupManager = new PopupManager({
      scene: this,
      resolveBuildingLabel: (type) => BUILDING_LABELS[type],
      getBuildingAnchor: (type) => this.getBuildingAnchor(type),
      normalizeBuildingLevel,
      resolveUpgradeCostInfo: (type, level) =>
        this.sceneApiService.resolveUpgradeCostInfo(type, level),
      requestBuildingUpgrade: (type, currentLevel) =>
        this.sceneApiService.requestBuildingUpgrade(type, currentLevel),
      resolveBuildingPopupStatus: (type) => this.resolveBuildingPopupStatus(type),
      getAssignedWorkersWithElapsedForBuilding: (type) =>
        this.getAssignedWorkersWithElapsedForBuilding(type),
      resolveTheme: () => this.resolvePopupThemeTokens(),
    });
  }

  create(): void {
    this.drawGroundTiles();
    this.drawRoadTiles();
    this.renderBuildings();
    this.lastBuildingPlacementSignature = this.resolveBuildingPlacementSignature(
      this.resolveObstacleBuildingPlacements()
    );
    this.configureCamera();
    this.configureInput();
    this.initializeDecorationPlacementGuide();
    this.initializeBuildingPlacementGuide();
    this.initializeBuildingPlacementTileOverlay();

    this.game.events.on(TASKS_UPDATED_EVENT, this.handleTasksUpdated, this);
    this.game.events.on(BUILDING_LEVELS_UPDATED_EVENT, this.handleBuildingLevelsUpdated, this);
    this.game.events.on(DECORATIONS_UPDATED_EVENT, this.handleDecorationsUpdated, this);
    if (typeof window !== 'undefined') {
      window.addEventListener(
        DECORATION_PLACEMENT_START_EVENT,
        this.handleDecorationPlacementStartEvent as EventListener
      );
      window.addEventListener(
        BUILDING_PLACEMENT_START_EVENT,
        this.handleBuildingPlacementStartEvent as EventListener
      );
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleScaleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(TASKS_UPDATED_EVENT, this.handleTasksUpdated, this);
      this.game.events.off(BUILDING_LEVELS_UPDATED_EVENT, this.handleBuildingLevelsUpdated, this);
      this.game.events.off(DECORATIONS_UPDATED_EVENT, this.handleDecorationsUpdated, this);
      if (typeof window !== 'undefined') {
        window.removeEventListener(
          DECORATION_PLACEMENT_START_EVENT,
          this.handleDecorationPlacementStartEvent as EventListener
        );
        window.removeEventListener(
          BUILDING_PLACEMENT_START_EVENT,
          this.handleBuildingPlacementStartEvent as EventListener
        );
      }
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleScaleResize, this);
      this.input.off('wheel', this.handleInputWheel);
      this.input.off('pointerdown', this.handleInputPointerDown);
      this.input.off('pointermove', this.handleInputPointerMove);
      this.input.off('pointerup', this.handleInputPointerUp);
      this.input.off('pointerout', this.handleInputPointerOut);
      this.input.keyboard?.off('keydown-ESC', this.handleEscKeyDown);
      this.pendingDecorationPlacementType = null;
      this.pendingBuildingPlacementType = null;
      this.disableBuildingPlacementMode();
      this.clearDecorationPlacementGuide();
      this.decorationPlacementGuide?.destroy();
      this.decorationPlacementGuide = null;
      this.buildingPlacementGuide?.destroy();
      this.buildingPlacementGuide = null;
      this.buildingPlacementTileOverlay?.destroy();
      this.buildingPlacementTileOverlay = null;
      this.clearDecorationPlacementNotice();
      this.decorationPlacementNoticeText?.destroy();
      this.decorationPlacementNoticeText = null;
      this.buildingPlacementStatusBar?.destroy(true);
      this.buildingPlacementStatusBar = null;
      this.buildingPlacementStatusBarBackground = null;
      this.buildingPlacementStatusBarText = null;
      for (const building of this.buildings.values()) {
        building.destroy();
      }
      this.buildings.clear();
      this.invalidateObstacleBuildingPlacementCache();
      this.clearBuildingTileVisuals();
      this.destroyRoadTiles();
      this.clearDecorations();
      for (const tween of this.buildingFailureTweens.values()) {
        tween.stop();
      }
      this.buildingFailureTweens.clear();
      this.lastBuildingPlacementSignature = '';
      this.closeBuildingPopup();
      this.characterManager?.destroy();
      this.characterManager = null;
    });

    this.initializeCharacterManager();
    this.game.events.emit(TASKS_REQUEST_EVENT);
    this.game.events.emit(BUILDING_LEVELS_REQUEST_EVENT);
    this.game.events.emit(DECORATIONS_REQUEST_EVENT);
  }

  update(): void {
    this.updateCameraPan();
    this.syncBuildingLayoutFromState();
  }

  private drawGroundTiles(): void {
    for (let tileY = 0; tileY < MAP_HEIGHT; tileY += 1) {
      for (let tileX = 0; tileX < MAP_WIDTH; tileX += 1) {
        const worldPosition = this.tileToWorld(tileX, tileY);
        this.add
          .image(worldPosition.x, worldPosition.y, GROUND_TEXTURE_KEY)
          .setDepth(GROUND_TILE_DEPTH);
      }
    }
  }

  private getOrCreateRoadTileContainer(): Phaser.GameObjects.Container {
    if (this.roadTileContainer) {
      return this.roadTileContainer;
    }

    this.roadTileContainer = this.add.container(0, 0).setDepth(ROAD_TILE_DEPTH);
    return this.roadTileContainer;
  }

  private destroyRoadTiles(): void {
    if (!this.roadTileContainer) {
      return;
    }

    this.roadTileContainer.destroy(true);
    this.roadTileContainer = null;
  }

  private drawRoadTiles(): void {
    const roadTileContainer = this.getOrCreateRoadTileContainer();
    roadTileContainer.removeAll(true);

    const buildingLayout = this.resolveObstacleBuildingPlacements();
    const castle = buildingLayout.find((entry) => entry.type === 'castle');
    if (!castle) {
      return;
    }

    const from = {
      x: castle.tileX + 1,
      y: castle.tileY + 1,
    };

    const roadTiles = new Set<string>();
    for (const placement of buildingLayout) {
      if (placement.type === 'castle') {
        continue;
      }

      const path = this.buildRoadPath(from, {
        x: placement.tileX,
        y: placement.tileY,
      });
      for (const tile of path) {
        roadTiles.add(`${tile.x},${tile.y}`);
      }
    }

    for (const roadTile of roadTiles) {
      const [tileXRaw, tileYRaw] = roadTile.split(',');
      const tileX = Number.parseInt(tileXRaw, 10);
      const tileY = Number.parseInt(tileYRaw, 10);
      const world = this.tileToWorld(tileX, tileY);
      roadTileContainer.add(this.add.image(world.x, world.y, ROAD_TEXTURE_KEY));
    }
  }

  private renderBuildings(): void {
    const buildingLayout = this.resolveObstacleBuildingPlacements();
    for (const building of buildingLayout) {
      const anchor = this.tileToWorld(
        building.tileX + (building.width - 1) / 2,
        building.tileY + (building.height - 1) / 2
      );
      this.buildingAnchors.set(building.type, anchor.clone());
    }

    this.renderBuildingTileVisuals();
    this.renderBuildingsWithFactory();
  }

  private renderBuildingsWithFactory(): void {
    const buildingLayout = this.resolveObstacleBuildingPlacements();
    for (const building of this.buildings.values()) {
      building.destroy();
    }
    this.buildings.clear();
    for (const placement of buildingLayout) {
      const anchor = this.getBuildingAnchor(placement.type);
      const building = createBuilding(this, placement.type, this.buildingLevels[placement.type], {
        x: anchor.x,
        y: anchor.y,
      });
      building.setDepth(this.resolveBuildingDepth(placement));
      building.setWorking(false);
      building.on('building:click', (payload: BuildingClickPayload) => {
        this.handleBuildingClick(payload);
      });
      this.buildings.set(placement.type, building);
    }
  }

  private renderBuildingTileVisuals(): void {
    const buildingLayout = this.resolveObstacleBuildingPlacements();
    this.clearBuildingTileVisuals();

    for (const placement of buildingLayout) {
      const graphics = this.add.graphics();
      const color = BUILDING_TILE_VISUAL_COLORS[placement.type] ?? 0x94a3b8;
      graphics.setDepth(this.resolveBuildingDepth(placement) - 1.5);

      for (let offsetY = 0; offsetY < placement.height; offsetY += 1) {
        for (let offsetX = 0; offsetX < placement.width; offsetX += 1) {
          const tileX = placement.tileX + offsetX;
          const tileY = placement.tileY + offsetY;
          this.drawTileDiamond(graphics, tileX, tileY, color);
        }
      }

      this.buildingTileVisuals.set(placement.type, graphics);
    }
  }

  private clearBuildingTileVisuals(): void {
    for (const graphics of this.buildingTileVisuals.values()) {
      graphics.destroy();
    }
    this.buildingTileVisuals.clear();
  }

  private drawTileDiamond(
    graphics: Phaser.GameObjects.Graphics,
    tileX: number,
    tileY: number,
    color: number
  ): void {
    const center = this.tileToWorld(tileX, tileY);
    const halfWidth = TILE_WIDTH / 2;
    const halfHeight = TILE_HEIGHT / 2;

    graphics.fillStyle(color, 0.38);
    graphics.lineStyle(2, color, 0.6);
    graphics.beginPath();
    graphics.moveTo(center.x, center.y - halfHeight);
    graphics.lineTo(center.x + halfWidth, center.y);
    graphics.lineTo(center.x, center.y + halfHeight);
    graphics.lineTo(center.x - halfWidth, center.y);
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
  }

  private resolveBuildingDepth(placement: BuildingPlacement): number {
    const depthAnchor = this.tileToWorld(
      placement.tileX + (placement.width - 1) / 2,
      placement.tileY + placement.height
    );
    return depthAnchor.y + BUILDING_DEPTH_OFFSET;
  }

  private resolveDecorationVisual(type: string): DecorationVisualMeta {
    const normalized = type.trim().toLowerCase();
    return (
      DECORATION_VISUALS[normalized] ?? {
        emoji: '🎏',
        badgeColor: 0x94a3b8,
      }
    );
  }

  private normalizeDecorations(decorations: Decoration[]): PlacedDecoration[] {
    const normalized: PlacedDecoration[] = [];
    const seenIds = new Set<string>();
    const occupiedTiles = this.resolveDecorationBaseBlockedTiles();

    for (const decoration of decorations) {
      if (
        !decoration ||
        typeof decoration.id !== 'string' ||
        decoration.id.trim().length === 0 ||
        typeof decoration.type !== 'string' ||
        decoration.type.trim().length === 0 ||
        typeof decoration.position?.x !== 'number' ||
        !Number.isFinite(decoration.position.x) ||
        typeof decoration.position?.y !== 'number' ||
        !Number.isFinite(decoration.position.y)
      ) {
        continue;
      }

      const id = decoration.id.trim();
      if (seenIds.has(id)) {
        continue;
      }

      seenIds.add(id);
      const requestedTile = {
        x: Phaser.Math.Clamp(Math.floor(decoration.position.x), 0, MAP_WIDTH - 1),
        y: Phaser.Math.Clamp(Math.floor(decoration.position.y), 0, MAP_HEIGHT - 1),
      };
      const placedTile = this.resolveNearestDecorationTile(requestedTile, occupiedTiles);
      if (!placedTile) {
        continue;
      }

      occupiedTiles.add(this.toTileKey(placedTile.x, placedTile.y));
      normalized.push({
        id,
        type: decoration.type.trim(),
        ...(typeof decoration.level === 'number' && Number.isFinite(decoration.level)
          ? { level: Math.max(1, Math.min(5, Math.floor(decoration.level))) }
          : {}),
        ...(decoration.passiveEffect &&
        (decoration.passiveEffect.type === 'gold_bonus' ||
          decoration.passiveEffect.type === 'xp_bonus' ||
          decoration.passiveEffect.type === 'drop_rate_bonus') &&
        typeof decoration.passiveEffect.bonusPerLevel === 'number' &&
        Number.isFinite(decoration.passiveEffect.bonusPerLevel) &&
        decoration.passiveEffect.bonusPerLevel > 0
          ? {
              passiveEffect: {
                type: decoration.passiveEffect.type,
                bonusPerLevel: decoration.passiveEffect.bonusPerLevel,
              },
            }
          : {}),
        position: {
          x: placedTile.x,
          y: placedTile.y,
        },
      });
    }

    return normalized;
  }

  private clearDecorations(): void {
    for (const sprite of this.decorationSprites.values()) {
      sprite.destroy(true);
    }
    this.decorationSprites.clear();
    this.decorationRenderSignatures.clear();
  }

  private resolveLatestDecorationById(id: string): PlacedDecoration | null {
    for (const decoration of this.latestDecorations) {
      if (decoration.id === id) {
        return decoration;
      }
    }

    return null;
  }

  private resolveDecorationRenderSignature(decoration: PlacedDecoration): string {
    const levelSignature =
      typeof decoration.level === 'number' && Number.isFinite(decoration.level)
        ? String(Math.floor(decoration.level))
        : '';
    const passiveEffect = decoration.passiveEffect;
    const passiveEffectSignature =
      passiveEffect &&
      (passiveEffect.type === 'gold_bonus' ||
        passiveEffect.type === 'xp_bonus' ||
        passiveEffect.type === 'drop_rate_bonus') &&
      typeof passiveEffect.bonusPerLevel === 'number' &&
      Number.isFinite(passiveEffect.bonusPerLevel)
        ? `${passiveEffect.type}:${passiveEffect.bonusPerLevel}`
        : '';

    return [
      decoration.id,
      decoration.type,
      decoration.position.x,
      decoration.position.y,
      levelSignature,
      passiveEffectSignature,
    ].join('|');
  }

  private createDecorationSprite(decoration: PlacedDecoration): Phaser.GameObjects.Container {
    const worldPosition = this.tileToWorld(decoration.position.x, decoration.position.y);
    const visual = this.resolveDecorationVisual(decoration.type);
    const container = this.add
      .container(worldPosition.x, worldPosition.y + DECORATION_CONTAINER_Y_OFFSET)
      .setDepth(worldPosition.y + DECORATION_DEPTH_OFFSET);

    const shadow = this.add.ellipse(0, DECORATION_SHADOW_CENTER_Y, 24, 10, 0x020617, 0.35);
    const badge = this.add
      .circle(0, 0, 11, visual.badgeColor, 0.78)
      .setStrokeStyle(1.5, 0xf8fafc, 0.3);
    const emoji = this.add
      .text(0, -1, visual.emoji, {
        fontFamily: '"Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif',
        fontSize: '18px',
      })
      .setOrigin(0.5);

    container.add([shadow, badge, emoji]);
    container.setSize(28, 28);
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 14), Phaser.Geom.Circle.Contains);
    container.on(
      'pointerdown',
      (
        pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
        if (!pointer.leftButtonDown()) {
          return;
        }

        const latestDecoration = this.resolveLatestDecorationById(decoration.id);
        if (!latestDecoration) {
          return;
        }

        this.handleDecorationClick(latestDecoration);
      }
    );

    return container;
  }

  private renderDecorations(): void {
    const nextDecorationsById = new Map<string, PlacedDecoration>();
    for (const decoration of this.latestDecorations) {
      nextDecorationsById.set(decoration.id, decoration);
    }

    const removedDecorationIds: string[] = [];
    for (const decorationId of this.decorationSprites.keys()) {
      if (!nextDecorationsById.has(decorationId)) {
        removedDecorationIds.push(decorationId);
      }
    }
    for (const decorationId of removedDecorationIds) {
      this.decorationSprites.get(decorationId)?.destroy(true);
      this.decorationSprites.delete(decorationId);
      this.decorationRenderSignatures.delete(decorationId);
    }

    for (const [decorationId, decoration] of nextDecorationsById.entries()) {
      const nextSignature = this.resolveDecorationRenderSignature(decoration);
      const currentSignature = this.decorationRenderSignatures.get(decorationId);
      const currentSprite = this.decorationSprites.get(decorationId);
      if (currentSprite && currentSignature === nextSignature) {
        continue;
      }

      if (currentSprite) {
        currentSprite.destroy(true);
      }

      const sprite = this.createDecorationSprite(decoration);
      this.decorationSprites.set(decorationId, sprite);
      this.decorationRenderSignatures.set(decorationId, nextSignature);
    }
  }

  private resolveNearestDecorationTile(
    requestedTile: GridTile,
    blockedTiles: Set<string>
  ): GridTile | null {
    return resolveNearestDecorationTileFromService(
      requestedTile,
      blockedTiles,
      MAP_WIDTH,
      MAP_HEIGHT
    );
  }

  private initializeCharacterManager(): void {
    this.characterManager = this.createPlaceholderCharacterManager();
    this.characterManager.handleTasksUpdated(this.latestTasks);
  }

  private createPlaceholderCharacterManager(): CharacterManagerAdapter {
    return {
      handleTasksUpdated: (tasks) => {
        const previousStatuses = new Map(this.workerStatuses);
        const previousAssignments = new Map(this.workerBuildingAssignments);
        const displayStates = this.toDisplayStates(tasks);
        this.syncBuildingAssignments(displayStates);
        const shouldAnimate = this.hasHydratedInitialPositions;
        this.applyDisplayStates(displayStates, shouldAnimate);
        this.updateBuildingEffects(displayStates, previousStatuses, previousAssignments);
        this.hasHydratedInitialPositions = true;
      },
      destroy: () => {
        for (const tween of this.characterTweens.values()) {
          tween.stop();
        }
        this.characterTweens.clear();

        for (const sprite of this.placeholderCharacters.values()) {
          sprite.destroy();
        }
        this.placeholderCharacters.clear();
        for (const effects of this.characterEffects.values()) {
          effects.destroy();
        }
        this.characterEffects.clear();
        for (const anchor of this.characterEffectAnchors.values()) {
          anchor.destroy();
        }
        this.characterEffectAnchors.clear();

        this.workerStatuses.clear();
        this.workerBuildingAssignments.clear();
        this.hasHydratedInitialPositions = false;
      },
    };
  }

  private toDisplayStates(tasks: TaskUpdatePayload[]): WorkerDisplayState[] {
    return toDisplayStatesFromState(tasks);
  }

  private syncBuildingAssignments(displayStates: WorkerDisplayState[]): void {
    syncBuildingAssignmentsFromState(
      displayStates,
      this.workerBuildingAssignments,
      this.workingBuildingTypes
    );
  }

  private resolveStrictBuildingFromCategory(
    category: TaskUpdatePayload['category'] | null
  ): BuildingType | null {
    return resolveStrictBuildingFromCategoryFromState(category);
  }

  private pickWorkingBuilding(occupiedBuildings: Set<BuildingType>): BuildingType {
    return pickWorkingBuildingFromState(occupiedBuildings, this.workingBuildingTypes);
  }

  private isActiveWorkingStatus(status: CharacterDisplayStatus): boolean {
    return isActiveWorkingStatusFromState(status);
  }

  private updateBuildingEffects(
    displayStates: WorkerDisplayState[],
    previousStatuses: Map<string, CharacterDisplayStatus>,
    previousAssignments: Map<string, BuildingType>
  ): void {
    const activeWorkerCounts = new Map<BuildingType, number>();
    const completionBuildings = new Set<BuildingType>();
    const failedBuildings = new Set<BuildingType>();

    for (const state of displayStates) {
      const currentBuilding = this.workerBuildingAssignments.get(state.workerId);
      const previousBuilding = previousAssignments.get(state.workerId);
      const previousStatus = previousStatuses.get(state.workerId);

      if (currentBuilding && this.isActiveWorkingStatus(state.status)) {
        activeWorkerCounts.set(currentBuilding, (activeWorkerCounts.get(currentBuilding) ?? 0) + 1);
      }

      if (
        state.status === 'done' &&
        previousStatus !== undefined &&
        previousStatus !== 'done' &&
        previousBuilding
      ) {
        completionBuildings.add(previousBuilding);
      }

      if (
        (state.status === 'failed' || state.status === 'blocked') &&
        previousStatus !== state.status
      ) {
        const failedBuilding = currentBuilding ?? previousBuilding;
        if (failedBuilding) {
          failedBuildings.add(failedBuilding);
        }
      }
    }

    for (const [buildingType, building] of this.buildings.entries()) {
      if (completionBuildings.has(buildingType)) {
        building.playCompletionEffect();
      }
      if (failedBuildings.has(buildingType)) {
        this.playBuildingFailureEffect(buildingType, building);
      }
      const isWorking = (activeWorkerCounts.get(buildingType) ?? 0) > 0;
      building.setWorking(isWorking);
    }
  }

  private playBuildingFailureEffect(buildingType: BuildingType, building: Building): void {
    const activeTween = this.buildingFailureTweens.get(buildingType);
    if (activeTween) {
      activeTween.stop();
      this.buildingFailureTweens.delete(buildingType);
    }

    building.setWorking(false);
    const tween = this.tweens.add({
      targets: building,
      alpha: { from: 1, to: 0.42 },
      duration: 220,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.InOut',
      onComplete: () => {
        building.setAlpha(1);
        this.buildingFailureTweens.delete(buildingType);
      },
      onStop: () => {
        building.setAlpha(1);
        this.buildingFailureTweens.delete(buildingType);
      },
    });

    this.buildingFailureTweens.set(buildingType, tween);
  }

  private applyDisplayStates(displayStates: WorkerDisplayState[], animate: boolean): void {
    const innWaitingWorkerIds = displayStates
      .filter((state) => this.isInnWaitingStatus(state.status))
      .map((state) => state.workerId);
    const innWaitingCount = innWaitingWorkerIds.length;

    displayStates.forEach((state, index) => {
      const innWaitingSlot = innWaitingWorkerIds.indexOf(state.workerId);
      const destination = this.resolveDestinationForState(
        state,
        index,
        innWaitingSlot,
        innWaitingCount
      );
      const sprite = this.getOrCreateCharacter(state.workerId, destination);
      const previousStatus = this.workerStatuses.get(state.workerId);
      const distance = Phaser.Math.Distance.Between(
        sprite.x,
        sprite.y,
        destination.x,
        destination.y
      );
      const shouldMove = animate && (previousStatus !== state.status || distance > 3);

      this.moveCharacterTo(state.workerId, sprite, destination, shouldMove);
      this.applyCharacterTint(state.status, sprite);
      this.applyCharacterStatusEffects(state.workerId, state.status, previousStatus);
      this.workerStatuses.set(state.workerId, state.status);
    });
  }

  private applyCharacterStatusEffects(
    workerId: string,
    status: CharacterDisplayStatus,
    previousStatus: CharacterDisplayStatus | undefined
  ): void {
    const effects = this.characterEffects.get(workerId);
    if (!effects) {
      return;
    }

    if (status === 'assigned' || status === 'working') {
      effects.startWorkingEffect();
    } else {
      effects.stopWorkingEffect();
    }

    if (status === 'done' && previousStatus !== 'done') {
      effects.playCompletionStars();
    }

    const isFailed = status === 'failed' || status === 'blocked';
    const wasFailed = previousStatus === 'failed' || previousStatus === 'blocked';
    if (isFailed && !wasFailed) {
      effects.playFailureFlash();
    }

    if (status === 'idle' && previousStatus && previousStatus !== 'idle') {
      effects.clearTransientEffects();
    }
  }

  private resolveDestinationForState(
    state: WorkerDisplayState,
    index: number,
    innWaitingSlot: number,
    innWaitingCount: number
  ): Phaser.Math.Vector2 {
    if (state.status === 'idle' || state.status === 'done') {
      return this.resolveIdlePosition(
        innWaitingSlot >= 0 ? innWaitingSlot : index,
        innWaitingCount
      );
    }

    if (this.isInnWaitingStatus(state.status)) {
      return this.resolveIdlePosition(
        innWaitingSlot >= 0 ? innWaitingSlot : index,
        innWaitingCount
      );
    }

    if (this.requiresBuildingAssignment(state.status)) {
      const assignedBuilding =
        this.workerBuildingAssignments.get(state.workerId) ??
        this.resolveStrictBuildingFromCategory(state.category) ??
        this.pickWorkingBuilding(new Set<BuildingType>());
      return this.resolveWorkingCharacterPosition(assignedBuilding, state.workerId);
    }

    return this.resolveIdlePosition(index, innWaitingCount);
  }

  private resolveIdlePosition(index: number, idleCount: number): Phaser.Math.Vector2 {
    const inn = this.getBuildingAnchor('inn');
    const safeIdleCount = Math.max(1, idleCount);
    const columns = Math.min(3, safeIdleCount);
    const row = Math.floor(index / columns);
    const col = index % columns;
    const centeredCol = col - (columns - 1) / 2;
    const rowOffsetX = row % 2 === 1 ? 12 : 0;
    const x = inn.x + centeredCol * 30 + rowOffsetX;
    const y = inn.y + 26 + row * 20;

    return new Phaser.Math.Vector2(x, y);
  }

  private requiresBuildingAssignment(status: CharacterDisplayStatus): boolean {
    return requiresBuildingAssignmentFromState(status);
  }

  private isInnWaitingStatus(status: CharacterDisplayStatus): boolean {
    return isInnWaitingStatusFromState(status);
  }

  private resolveWorkingCharacterPosition(
    buildingType: BuildingType,
    workerId: string
  ): Phaser.Math.Vector2 {
    const placement = this.resolveObstacleBuildingPlacementByType(buildingType);
    if (!placement) {
      return this.getBuildingAnchor(buildingType).clone();
    }

    const assignedWorkerIds = this.getWorkerIdsAssignedToBuilding(buildingType);
    const slotIndex = Math.max(0, assignedWorkerIds.indexOf(workerId));
    const totalWorkers = Math.max(1, assignedWorkerIds.length);
    const columns = Math.min(3, totalWorkers);
    const column = slotIndex % columns;
    const row = Math.floor(slotIndex / columns);
    const centeredColumn = column - (columns - 1) / 2;
    const staggerX = row % 2 === 1 ? 0.3 : 0;
    const tileX = Phaser.Math.Clamp(
      placement.tileX + (placement.width - 1) / 2 + centeredColumn * 0.95 + staggerX,
      0,
      MAP_WIDTH - 1
    );
    const tileY = Phaser.Math.Clamp(
      placement.tileY + placement.height + row * 0.85,
      0,
      MAP_HEIGHT - 1
    );
    const world = this.tileToWorld(tileX, tileY);

    return new Phaser.Math.Vector2(world.x, world.y + 8);
  }

  private getWorkerIdsAssignedToBuilding(type: BuildingType): string[] {
    return getWorkerIdsAssignedToBuildingFromState(type, this.workerBuildingAssignments);
  }

  private moveCharacterTo(
    workerId: string,
    sprite: Phaser.GameObjects.Image,
    destination: Phaser.Math.Vector2,
    animate: boolean
  ): void {
    const activeTween = this.characterTweens.get(workerId);
    if (activeTween) {
      activeTween.stop();
      this.characterTweens.delete(workerId);
    }

    if (!animate) {
      sprite.setPosition(destination.x, destination.y);
      const depth = this.resolveCharacterDepthForWorker(workerId, destination.y);
      sprite.setDepth(depth);
      this.syncCharacterEffectAnchor(
        workerId,
        destination.x,
        destination.y,
        this.resolveCharacterEffectDepthForWorker(workerId, destination.y)
      );
      return;
    }

    const waypoints = this.resolveCharacterPathWaypoints(sprite, destination);
    if (waypoints.length === 0) {
      const depth = this.resolveCharacterDepthForWorker(workerId, sprite.y);
      sprite.setDepth(depth);
      this.syncCharacterEffectAnchor(
        workerId,
        sprite.x,
        sprite.y,
        this.resolveCharacterEffectDepthForWorker(workerId, sprite.y)
      );
      return;
    }

    this.playCharacterPathTween(workerId, sprite, waypoints, 0);
  }

  private playCharacterPathTween(
    workerId: string,
    sprite: Phaser.GameObjects.Image,
    waypoints: Phaser.Math.Vector2[],
    index: number
  ): void {
    if (index >= waypoints.length) {
      this.syncCharacterEffectAnchor(
        workerId,
        sprite.x,
        sprite.y,
        this.resolveCharacterEffectDepthForWorker(workerId, sprite.y)
      );
      this.characterTweens.delete(workerId);
      return;
    }

    const waypoint = waypoints[index];
    const stepDistance = Phaser.Math.Distance.Between(sprite.x, sprite.y, waypoint.x, waypoint.y);
    const tween = this.tweens.add({
      targets: sprite,
      x: waypoint.x,
      y: waypoint.y,
      duration: Phaser.Math.Clamp(Math.round(stepDistance * 5), 150, 340),
      ease: 'Linear',
      onUpdate: () => {
        sprite.setDepth(this.resolveCharacterDepthForWorker(workerId, sprite.y));
        this.syncCharacterEffectAnchor(
          workerId,
          sprite.x,
          sprite.y,
          this.resolveCharacterEffectDepthForWorker(workerId, sprite.y)
        );
      },
      onComplete: () => {
        this.playCharacterPathTween(workerId, sprite, waypoints, index + 1);
      },
      onStop: () => {
        this.syncCharacterEffectAnchor(
          workerId,
          sprite.x,
          sprite.y,
          this.resolveCharacterEffectDepthForWorker(workerId, sprite.y)
        );
        this.characterTweens.delete(workerId);
      },
    });

    this.characterTweens.set(workerId, tween);
  }

  private resolveCharacterPathWaypoints(
    sprite: Phaser.GameObjects.Image,
    destination: Phaser.Math.Vector2
  ): Phaser.Math.Vector2[] {
    const startTile = this.worldToTile(sprite.x, sprite.y);
    const targetTile = this.worldToTile(destination.x, destination.y);
    const blockedTiles = this.resolveBlockedTilesFromGameState();
    blockedTiles.delete(this.toTileKey(startTile.x, startTile.y));

    const goalTile = this.resolveNearestWalkableTile(targetTile, blockedTiles, startTile);
    const tilePath = this.findAStarTilePath(startTile, goalTile, blockedTiles);

    if (tilePath.length === 0) {
      return [];
    }

    const waypoints = tilePath.slice(1).map((tile) => this.tileToWorld(tile.x, tile.y));

    if (waypoints.length === 0) {
      if (startTile.x !== goalTile.x || startTile.y !== goalTile.y) {
        return [];
      }
      if (Phaser.Math.Distance.Between(sprite.x, sprite.y, destination.x, destination.y) <= 2) {
        return [];
      }
      return [destination.clone()];
    }

    const finalWaypoint = waypoints[waypoints.length - 1];
    if (
      !finalWaypoint ||
      Phaser.Math.Distance.Between(finalWaypoint.x, finalWaypoint.y, destination.x, destination.y) >
        2
    ) {
      waypoints.push(destination.clone());
    }

    return waypoints;
  }

  private worldToTile(worldX: number, worldY: number): GridTile {
    const cart = isoToCart(worldX - this.mapOrigin.x, worldY - this.mapOrigin.y);
    return {
      x: Phaser.Math.Clamp(Math.round(cart.x), 0, MAP_WIDTH - 1),
      y: Phaser.Math.Clamp(Math.round(cart.y), 0, MAP_HEIGHT - 1),
    };
  }

  private resolveBlockedTilesFromGameState(): Set<string> {
    const placements = this.resolveObstacleBuildingPlacements();
    const blockedTiles = createBlockedTilesFromPlacements(placements, MAP_WIDTH, MAP_HEIGHT);
    for (const decoration of this.latestDecorations) {
      if (
        typeof decoration.position.x !== 'number' ||
        !Number.isFinite(decoration.position.x) ||
        typeof decoration.position.y !== 'number' ||
        !Number.isFinite(decoration.position.y)
      ) {
        continue;
      }

      const tileX = Phaser.Math.Clamp(Math.floor(decoration.position.x), 0, MAP_WIDTH - 1);
      const tileY = Phaser.Math.Clamp(Math.floor(decoration.position.y), 0, MAP_HEIGHT - 1);
      blockedTiles.add(this.toTileKey(tileX, tileY));
    }

    return blockedTiles;
  }

  private resolveBuildingLevelSnapshot(levels: BuildingLevelPayload = this.buildingLevels): string {
    return BUILDING_LAYOUT.map((entry) => `${entry.type}:${levels[entry.type]}`).join('|');
  }

  private resolveBuildingPlacementSignature(placements: readonly BuildingPlacement[]): string {
    return placements
      .map((placement) => {
        return `${placement.type}:${placement.tileX},${placement.tileY},${placement.width},${placement.height}`;
      })
      .join('|');
  }

  private syncBuildingLayoutFromState(): void {
    const placements = this.resolveObstacleBuildingPlacements();
    const nextSignature = this.resolveBuildingPlacementSignature(placements);
    if (nextSignature === this.lastBuildingPlacementSignature) {
      return;
    }

    this.lastBuildingPlacementSignature = nextSignature;
    this.renderBuildings();
    this.drawRoadTiles();
    this.repositionCharactersForCurrentBuildingLayout();
    this.applyCurrentWorkingBuildingStates();
    this.renderDecorations();
    this.closeBuildingPopup();
    if (this.pendingBuildingPlacementType !== null) {
      this.updateBuildingPlacementGuide(this.input.activePointer);
    }
  }

  private invalidateObstacleBuildingPlacementCache(): void {
    this.obstacleBuildingPlacementCache = null;
    this.obstacleBuildingPlacementCacheBuildingsRef = null;
    this.obstacleBuildingPlacementCacheLevelSignature = '';
    this.obstacleBuildingPlacementByType.clear();
  }

  private repositionCharactersForCurrentBuildingLayout(): void {
    const displayStates = this.toDisplayStates(this.latestTasks);
    this.syncBuildingAssignments(displayStates);
    this.applyDisplayStates(displayStates, this.hasHydratedInitialPositions);
  }

  private resolveObstacleBuildingPlacements(): BuildingPlacement[] {
    const gameState = useGameStore.getState().gameState;
    const rawBuildings = gameState?.buildings;
    const levelSignature = this.resolveBuildingLevelSnapshot();

    if (
      this.obstacleBuildingPlacementCache !== null &&
      this.obstacleBuildingPlacementCacheBuildingsRef === rawBuildings &&
      this.obstacleBuildingPlacementCacheLevelSignature === levelSignature
    ) {
      return this.obstacleBuildingPlacementCache;
    }

    const placementsByType = new Map<BuildingType, BuildingPlacement>();
    if (Array.isArray(rawBuildings)) {
      for (const rawBuilding of rawBuildings) {
        if (typeof rawBuilding !== 'object' || rawBuilding === null) {
          continue;
        }

        const source = rawBuilding as {
          type?: unknown;
          position?: { x?: unknown; y?: unknown } | null;
        };
        const buildingType = toBuildingType(source.type);
        if (buildingType === null) {
          continue;
        }

        const config = BUILDING_CONFIGS[buildingType];
        const maxOriginX = Math.max(0, MAP_WIDTH - config.footprint.width);
        const maxOriginY = Math.max(0, MAP_HEIGHT - config.footprint.height);
        const x =
          typeof source.position?.x === 'number' && Number.isFinite(source.position.x)
            ? Math.floor(source.position.x)
            : (BUILDING_LAYOUT.find((entry) => entry.type === buildingType)?.tileX ??
              config.defaultTilePosition.x);
        const y =
          typeof source.position?.y === 'number' && Number.isFinite(source.position.y)
            ? Math.floor(source.position.y)
            : (BUILDING_LAYOUT.find((entry) => entry.type === buildingType)?.tileY ??
              config.defaultTilePosition.y);

        placementsByType.set(buildingType, {
          type: buildingType,
          tileX: Phaser.Math.Clamp(x, 0, maxOriginX),
          tileY: Phaser.Math.Clamp(y, 0, maxOriginY),
          width: config.footprint.width,
          height: config.footprint.height,
        });
      }
    }

    const placements = BUILDING_LAYOUT.map((fallback) => {
      const resolved = placementsByType.get(fallback.type);
      if (resolved) {
        return resolved;
      }

      return {
        type: fallback.type,
        tileX: fallback.tileX,
        tileY: fallback.tileY,
        width: fallback.width,
        height: fallback.height,
      };
    });
    this.obstacleBuildingPlacementCache = placements;
    this.obstacleBuildingPlacementCacheBuildingsRef = rawBuildings;
    this.obstacleBuildingPlacementCacheLevelSignature = levelSignature;
    this.obstacleBuildingPlacementByType.clear();
    for (const placement of placements) {
      this.obstacleBuildingPlacementByType.set(placement.type, placement);
    }

    return placements;
  }

  private resolveObstacleBuildingPlacementByType(type: BuildingType): BuildingPlacement | null {
    this.resolveObstacleBuildingPlacements();
    return this.obstacleBuildingPlacementByType.get(type) ?? null;
  }

  private findAStarTilePath(
    start: GridTile,
    goal: GridTile,
    blockedTiles: Set<string>
  ): GridTile[] {
    return findAStarPath(start, goal, blockedTiles, MAP_WIDTH, MAP_HEIGHT);
  }

  private resolveNearestWalkableTile(
    requestedGoal: GridTile,
    blockedTiles: Set<string>,
    startTile: GridTile
  ): GridTile {
    return resolveNearestWalkableTileFromService(
      requestedGoal,
      blockedTiles,
      startTile,
      MAP_WIDTH,
      MAP_HEIGHT
    );
  }

  private isTileInsideMap(tileX: number, tileY: number): boolean {
    return isTileInsideMapFromService(tileX, tileY, MAP_WIDTH, MAP_HEIGHT);
  }

  private toTileKey(tileX: number, tileY: number): string {
    return toTileKeyFromService(tileX, tileY);
  }

  private applyCharacterTint(
    status: CharacterDisplayStatus,
    sprite: Phaser.GameObjects.Image
  ): void {
    sprite.clearTint();
    if (status === 'failed' || status === 'blocked') {
      sprite.setTint(0xf87171);
    }
  }

  private getOrCreateCharacter(
    workerId: string,
    initialPosition: Phaser.Math.Vector2
  ): Phaser.GameObjects.Image {
    const existing = this.placeholderCharacters.get(workerId);
    if (existing) {
      return existing;
    }

    const workerIndex = toWorkerIndex(workerId);
    const paletteColor =
      CHARACTER_COLORS[Math.abs(workerIndex) % CHARACTER_COLORS.length] ?? '#60A5FA';
    const textureKey = generateCharacterTexture(this, paletteColor);
    const sprite = this.add
      .image(initialPosition.x, initialPosition.y, textureKey)
      .setDepth(this.resolveCharacterDepthForWorker(workerId, initialPosition.y));
    this.placeholderCharacters.set(workerId, sprite);

    const effectAnchor = this.add
      .container(initialPosition.x, initialPosition.y)
      .setDepth(this.resolveCharacterEffectDepthForWorker(workerId, initialPosition.y));
    this.characterEffectAnchors.set(workerId, effectAnchor);
    this.characterEffects.set(workerId, new CharacterEffects(this, effectAnchor));

    return sprite;
  }

  private resolveCharacterDepthForWorker(workerId: string, worldY: number): number {
    const baseDepth = this.resolveCharacterDepth(worldY);
    const assignedBuilding = this.workerBuildingAssignments.get(workerId);
    if (!assignedBuilding) {
      return baseDepth;
    }

    const building = this.buildings.get(assignedBuilding);
    if (!building) {
      return baseDepth;
    }

    return Math.max(baseDepth, building.depth + 2);
  }

  private resolveCharacterEffectDepthForWorker(workerId: string, worldY: number): number {
    return this.resolveCharacterDepthForWorker(workerId, worldY) + 0.1;
  }

  private resolveCharacterDepth(worldY: number): number {
    return worldY + BUILDING_DEPTH_OFFSET;
  }

  private syncCharacterEffectAnchor(workerId: string, x: number, y: number, depth: number): void {
    const anchor = this.characterEffectAnchors.get(workerId);
    if (!anchor) {
      return;
    }

    anchor.setPosition(x, y);
    anchor.setDepth(depth);
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBackgroundColor('#1A1A2E');
    camera.setBounds(CAMERA_BOUNDS.x, CAMERA_BOUNDS.y, CAMERA_BOUNDS.width, CAMERA_BOUNDS.height);
    camera.setZoom(1);
    this.applyVisibleCameraViewport();
    this.centerCameraOnCastle();
  }

  private resolveCastleAnchor(): Phaser.Math.Vector2 {
    const castleLayout = this.resolveObstacleBuildingPlacementByType('castle');
    return (
      this.buildingAnchors.get('castle') ??
      (castleLayout
        ? this.tileToWorld(
            castleLayout.tileX + (castleLayout.width - 1) / 2,
            castleLayout.tileY + (castleLayout.height - 1) / 2
          )
        : this.tileToWorld(MAP_WIDTH / 2, MAP_HEIGHT / 2))
    );
  }

  private centerCameraOnCastle(): void {
    const camera = this.cameras.main;
    const castleAnchor = this.resolveCastleAnchor();
    camera.centerOn(castleAnchor.x, castleAnchor.y);
  }

  private handleScaleResize(): void {
    // RESIZEモードでは初期レイアウト確定後にviewportが変わるため、城中心を再適用する。
    this.applyVisibleCameraViewport();
    this.centerCameraOnCastle();
    this.updateDecorationPlacementNoticePosition();
    this.updateBuildingPlacementStatusBarLayout();
  }

  private configureInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.on('wheel', this.handleInputWheel);
    this.input.on('pointerdown', this.handleInputPointerDown);
    this.input.on('pointermove', this.handleInputPointerMove);
    this.input.on('pointerup', this.handleInputPointerUp);
    this.input.on('pointerout', this.handleInputPointerOut);
    this.input.keyboard?.on('keydown-ESC', this.handleEscKeyDown);
  }

  private updateCameraPan(): void {
    if (!this.isDragging) {
      return;
    }

    const pointer = this.input.activePointer;
    if (!pointer.isDown) {
      this.isDragging = false;
      return;
    }

    const camera = this.cameras.main;
    const deltaX = (this.dragStartPointer.x - pointer.x) / camera.zoom;
    const deltaY = (this.dragStartPointer.y - pointer.y) / camera.zoom;
    camera.scrollX = this.dragStartCamera.x + deltaX;
    camera.scrollY = this.dragStartCamera.y + deltaY;
  }

  private isPointerDownOnBuilding(
    gameObjects: Phaser.GameObjects.GameObject[] | undefined
  ): boolean {
    if (!Array.isArray(gameObjects) || gameObjects.length === 0) {
      return false;
    }

    const targets = new Set(gameObjects);
    for (const building of this.buildings.values()) {
      if (targets.has(building)) {
        return true;
      }
    }

    for (const decoration of this.decorationSprites.values()) {
      if (targets.has(decoration)) {
        return true;
      }
    }

    return false;
  }

  private commitDecorationPlacement(pointer: Phaser.Input.Pointer): void {
    const decorationType = this.pendingDecorationPlacementType;
    if (!decorationType) {
      return;
    }

    const preview = this.resolveDecorationPlacementPreview(pointer);
    if (!preview) {
      this.showDecorationPlacementNotice('配置不可（地図外）');
      return;
    }
    if (!preview.canPlace) {
      this.showDecorationPlacementNotice(preview.failureReason ?? '配置不可（建物/装飾と重複）');
      return;
    }

    this.clearDecorationPlacementNotice();
    this.pendingDecorationPlacementType = null;
    this.isDragging = false;
    this.clearDecorationPlacementGuide();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(DECORATION_PLACEMENT_COMMIT_EVENT, {
          detail: {
            decorationType,
            position: preview.tile,
          },
        })
      );
    }
  }

  private cancelDecorationPlacement(message: string): void {
    this.pendingDecorationPlacementType = null;
    this.isDragging = false;
    this.clearDecorationPlacementGuide();
    this.clearDecorationPlacementNotice();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(DECORATION_PLACEMENT_CANCEL_EVENT, {
          detail: { message },
        })
      );
    }
  }

  private commitBuildingPlacement(pointer: Phaser.Input.Pointer): void {
    const buildingType = this.pendingBuildingPlacementType;
    if (buildingType === null) {
      return;
    }

    const preview = this.resolveBuildingPlacementPreview(pointer);
    if (!preview) {
      this.showDecorationPlacementNotice('移動不可（地図外）');
      return;
    }
    if (!preview.canPlace) {
      this.showDecorationPlacementNotice(preview.failureReason ?? '移動不可（建物/装飾と重複）');
      return;
    }

    this.clearDecorationPlacementNotice();
    this.pendingBuildingPlacementType = null;
    this.isDragging = false;
    this.disableBuildingPlacementMode();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(BUILDING_PLACEMENT_COMMIT_EVENT, {
          detail: {
            buildingId: buildingType,
            mode: 'move' as const,
            position: preview.origin,
          },
        })
      );
    }
  }

  private cancelBuildingPlacement(message: string): void {
    const buildingType = this.pendingBuildingPlacementType;
    this.pendingBuildingPlacementType = null;
    this.isDragging = false;
    this.disableBuildingPlacementMode();
    this.clearDecorationPlacementNotice();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(BUILDING_PLACEMENT_CANCEL_EVENT, {
          detail: {
            message,
            ...(buildingType !== null ? { buildingId: buildingType } : {}),
          },
        })
      );
    }
  }

  private handleTasksUpdated(tasks: TaskUpdatePayload[]): void {
    this.latestTasks = tasks;
    this.characterManager?.handleTasksUpdated(tasks);
  }

  private handleDecorationsUpdated(decorations: Decoration[]): void {
    this.latestDecorations = this.normalizeDecorations(decorations);
    this.renderDecorations();
    if (this.pendingDecorationPlacementType !== null) {
      this.updateDecorationPlacementGuide(this.input.activePointer);
    }
    if (this.pendingBuildingPlacementType !== null) {
      this.updateBuildingPlacementGuide(this.input.activePointer);
    }
  }

  private handleBuildingLevelsUpdated(levels: BuildingLevelPayload): void {
    const normalizedLevels: BuildingLevelPayload = {
      castle: normalizeBuildingLevel(levels.castle),
      mansion: normalizeBuildingLevel(levels.mansion),
      inn: normalizeBuildingLevel(levels.inn),
      dojo: normalizeBuildingLevel(levels.dojo),
      smithy: normalizeBuildingLevel(levels.smithy),
      training: normalizeBuildingLevel(levels.training),
      study: normalizeBuildingLevel(levels.study),
      healer: normalizeBuildingLevel(levels.healer),
      watchtower: normalizeBuildingLevel(levels.watchtower),
      scriptorium: normalizeBuildingLevel(levels.scriptorium),
    };

    const changedTypes = this.resolveChangedBuildingTypes(normalizedLevels);
    if (changedTypes.length === 0) {
      return;
    }

    this.buildingLevels = normalizedLevels;
    this.invalidateObstacleBuildingPlacementCache();

    let shouldRebuildAllBuildings = false;
    for (const type of changedTypes) {
      const building = this.buildings.get(type);
      if (!building) {
        shouldRebuildAllBuildings = true;
        continue;
      }
      building.setLevel(normalizedLevels[type]);
    }

    if (shouldRebuildAllBuildings) {
      this.renderBuildingsWithFactory();
    }

    this.applyCurrentWorkingBuildingStates();
    if (this.pendingBuildingPlacementType !== null) {
      this.updateBuildingPlacementGuide(this.input.activePointer);
    }
  }

  private resolveChangedBuildingTypes(nextLevels: BuildingLevelPayload): BuildingType[] {
    return BUILDING_LAYOUT.map((building) => building.type).filter(
      (type) => nextLevels[type] !== this.buildingLevels[type]
    );
  }

  private applyCurrentWorkingBuildingStates(): void {
    const activeWorkerCounts = new Map<BuildingType, number>();
    for (const [workerId, status] of this.workerStatuses.entries()) {
      if (!this.isActiveWorkingStatus(status)) {
        continue;
      }

      const assignedBuilding = this.workerBuildingAssignments.get(workerId);
      if (!assignedBuilding) {
        continue;
      }

      activeWorkerCounts.set(assignedBuilding, (activeWorkerCounts.get(assignedBuilding) ?? 0) + 1);
    }

    for (const [buildingType, building] of this.buildings.entries()) {
      building.setWorking((activeWorkerCounts.get(buildingType) ?? 0) > 0);
    }
  }

  private handleBuildingClick(payload: BuildingClickPayload): void {
    if (
      this.pendingDecorationPlacementType !== null ||
      this.pendingBuildingPlacementType !== null
    ) {
      return;
    }

    const assignees = this.getAssignedWorkersForBuilding(payload.type);
    const popupAssignees = this.getAssignedWorkersWithElapsedForBuilding(payload.type);
    const status = this.resolveBuildingPopupStatus(payload.type);
    const detail = {
      type: payload.type,
      level: payload.level,
      position: payload.position,
      status,
      assignees,
      label: BUILDING_LABELS[payload.type],
    };

    this.game.events.emit(BUILDING_CLICKED_EVENT, detail);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shogun:building-click', { detail }));
    }

    void this.openBuildingPopup(payload, status, popupAssignees);
  }

  private handleDecorationClick(decoration: PlacedDecoration): void {
    if (
      this.pendingDecorationPlacementType !== null ||
      this.pendingBuildingPlacementType !== null
    ) {
      return;
    }

    this.isDragging = false;
    this.closeBuildingPopup();
    const detail: DecorationClickDetail = {
      id: decoration.id,
      type: decoration.type,
      ...(typeof decoration.level === 'number' ? { level: decoration.level } : {}),
      ...(decoration.passiveEffect ? { passiveEffect: decoration.passiveEffect } : {}),
      position: {
        x: decoration.position.x,
        y: decoration.position.y,
      },
    };

    this.game.events.emit(DECORATION_CLICKED_EVENT, detail);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shogun:decoration-click', { detail }));
    }
  }

  private getAssignedWorkersForBuilding(type: BuildingType): string[] {
    return getAssignedWorkersForBuildingFromState(
      type,
      this.workerBuildingAssignments,
      this.workerStatuses,
      useGameStore.getState().gameState
    );
  }

  private getAssignedWorkersWithElapsedForBuilding(type: BuildingType): string[] {
    return getAssignedWorkersWithElapsedForBuildingFromState(
      type,
      this.workerBuildingAssignments,
      this.workerStatuses,
      this.latestTasks,
      useGameStore.getState().gameState
    );
  }

  private resolveBuildingPopupStatus(type: BuildingType): BuildingPopupStatus {
    return resolveBuildingPopupStatusFromState(
      type,
      this.workerBuildingAssignments,
      this.workerStatuses
    );
  }

  private applyBuildingUpgradeLevel(type: BuildingType, level: BuildingLevel): void {
    const normalizedLevel = normalizeBuildingLevel(level);
    this.buildingLevels[type] = normalizedLevel;
    this.invalidateObstacleBuildingPlacementCache();

    const building = this.buildings.get(type);
    if (!building) {
      return;
    }

    building.setLevel(normalizedLevel);
    building.playCompletionEffect();
  }

  private async openBuildingPopup(
    payload: BuildingClickPayload,
    status: BuildingPopupStatus,
    assignees: string[],
    initialMessage?: { text: string; color: string }
  ): Promise<void> {
    await this.popupManager.open(payload, status, assignees, initialMessage);
  }

  private isPointerInsideBuildingPopup(pointer: Phaser.Input.Pointer): boolean {
    return this.popupManager.isPointerInside(pointer);
  }

  private handlePopupPointerDown(pointer: Phaser.Input.Pointer): boolean {
    return this.popupManager.handlePointerDown(pointer);
  }

  private closeBuildingPopup(): void {
    this.popupManager.close();
  }

  private resolvePopupThemeTokens(): Partial<PopupThemeTokens> {
    if (typeof window === 'undefined') {
      return {};
    }

    const styles = window.getComputedStyle(document.documentElement);
    const readHexVar = (name: string): string | null =>
      normalizeHexColor(styles.getPropertyValue(name));

    const tokens: Partial<PopupThemeTokens> = {};
    const panelFillHex = readHexVar('--sumikuro');
    if (panelFillHex) {
      tokens.panelFill = toColorNumberFromHex(panelFillHex);
    }

    const panelStrokeHex = readHexVar('--kincha');
    if (panelStrokeHex) {
      tokens.panelStroke = toColorNumberFromHex(panelStrokeHex);
      tokens.titleText = panelStrokeHex;
    }

    const statusWorkingHex = readHexVar('--ruri');
    if (statusWorkingHex) {
      tokens.statusWorkingText = statusWorkingHex;
      tokens.rewardText = statusWorkingHex;
    }

    const statusBlockedHex = readHexVar('--syuaka');
    if (statusBlockedHex) {
      tokens.statusBlockedText = statusBlockedHex;
      tokens.dangerText = statusBlockedHex;
      tokens.closeButtonText = statusBlockedHex;
    }

    const successHex = readHexVar('--wakakusa');
    if (successHex) {
      tokens.dropText = successHex;
      tokens.successText = successHex;
      tokens.upgradeButtonEnabledStroke = toColorNumberFromHex(successHex);
    }

    const costHex = readHexVar('--yamabuki');
    if (costHex) {
      tokens.upgradeCostText = costHex;
      tokens.upgradeButtonEnabledText = costHex;
    }

    const closeBackgroundHex = readHexVar('--sumi');
    if (closeBackgroundHex) {
      tokens.closeButtonBackground = closeBackgroundHex;
    }

    const disabledFillHex = readHexVar('--konjou');
    if (disabledFillHex) {
      const disabledFill = toColorNumberFromHex(disabledFillHex);
      tokens.upgradeButtonDisabledFill = disabledFill;
      tokens.upgradeButtonDisabledStroke = disabledFill;
    }

    const enabledFillHex = readHexVar('--aitetsu');
    if (enabledFillHex) {
      tokens.upgradeButtonEnabledFill = toColorNumberFromHex(enabledFillHex);
    }

    return tokens;
  }

  private buildRoadPath(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): Array<{ x: number; y: number }> {
    return buildRoadPathTiles(from, to);
  }

  private tileToWorld(tileX: number, tileY: number): Phaser.Math.Vector2 {
    const position = tileToScreen(tileX, tileY);
    return new Phaser.Math.Vector2(this.mapOrigin.x + position.x, this.mapOrigin.y + position.y);
  }

  private enableBuildingPlacementMode(buildingType: BuildingType): void {
    this.setNonPlacementUiLocked(true);
    this.showBuildingPlacementStatusBar(BUILDING_PLACEMENT_STATUS_BAR_MESSAGE);
    this.renderBuildingPlacementTileOverlay(null);
    this.showDecorationPlacementNotice(
      BUILDING_PLACEMENT_FEEDBACK_TEMPLATE.replace(
        '%BUILDING%',
        BUILDING_LABELS[buildingType] ?? '建物'
      )
    );
  }

  private disableBuildingPlacementMode(): void {
    this.setNonPlacementUiLocked(false);
    this.hideBuildingPlacementStatusBar();
    this.clearBuildingPlacementGuide();
    this.clearBuildingPlacementTileOverlay();
  }

  private setNonPlacementUiLocked(locked: boolean): void {
    if (typeof document === 'undefined') {
      return;
    }

    if (!locked) {
      for (const [element, snapshot] of this.nonPlacementUiStyleSnapshots.entries()) {
        if (!element.isConnected) {
          continue;
        }

        element.style.pointerEvents = snapshot.pointerEvents;
        element.style.opacity = snapshot.opacity;
        element.style.filter = snapshot.filter;
      }
      this.nonPlacementUiStyleSnapshots.clear();
      return;
    }

    const targets = Array.from(document.querySelectorAll<HTMLElement>('.left-panel, .right-panel'));
    for (const target of targets) {
      if (!this.nonPlacementUiStyleSnapshots.has(target)) {
        this.nonPlacementUiStyleSnapshots.set(target, {
          pointerEvents: target.style.pointerEvents,
          opacity: target.style.opacity,
          filter: target.style.filter,
        });
      }

      target.style.pointerEvents = 'none';
      target.style.opacity = '0.58';
      target.style.filter = 'grayscale(0.18)';
    }
  }

  private initializeBuildingPlacementTileOverlay(): void {
    if (this.buildingPlacementTileOverlay) {
      return;
    }

    this.buildingPlacementTileOverlay = this.add.graphics();
    this.buildingPlacementTileOverlay.setDepth(BUILDING_PLACEMENT_TILE_OVERLAY_DEPTH);
    this.buildingPlacementTileOverlay.setVisible(false);
  }

  private ensureBuildingPlacementStatusBar(): Phaser.GameObjects.Container {
    if (this.buildingPlacementStatusBar) {
      return this.buildingPlacementStatusBar;
    }

    const background = this.add
      .rectangle(0, 0, 420, BUILDING_PLACEMENT_STATUS_BAR_HEIGHT, 0x0f172a, 0.9)
      .setStrokeStyle(1.5, 0x7dd3fc, 0.95)
      .setOrigin(0.5);
    const text = this.add
      .text(0, 0, BUILDING_PLACEMENT_STATUS_BAR_MESSAGE, {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: '#e2e8f0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const container = this.add
      .container(0, 0, [background, text])
      .setDepth(BUILDING_PLACEMENT_STATUS_BAR_DEPTH)
      .setScrollFactor(0)
      .setVisible(false);

    this.buildingPlacementStatusBar = container;
    this.buildingPlacementStatusBarBackground = background;
    this.buildingPlacementStatusBarText = text;
    this.updateBuildingPlacementStatusBarLayout();
    return container;
  }

  private updateBuildingPlacementStatusBarLayout(): void {
    const bar = this.buildingPlacementStatusBar;
    const background = this.buildingPlacementStatusBarBackground;
    if (!bar || !background) {
      return;
    }

    const camera = this.cameras.main;
    const barWidth = Phaser.Math.Clamp(camera.width - 24, 320, 760);
    background.setDisplaySize(barWidth, BUILDING_PLACEMENT_STATUS_BAR_HEIGHT);
    this.buildingPlacementStatusBarText?.setWordWrapWidth(Math.max(180, barWidth - 18), true);
    bar.setPosition(camera.x + camera.width / 2, camera.y + 18);
  }

  private showBuildingPlacementStatusBar(message: string): void {
    const bar = this.ensureBuildingPlacementStatusBar();
    this.buildingPlacementStatusBarText?.setText(message);
    this.updateBuildingPlacementStatusBarLayout();
    this.tweens.killTweensOf(bar);
    bar.setVisible(true);
    bar.setAlpha(0);
    bar.setScale(0.98);
    this.tweens.add({
      targets: bar,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 170,
      ease: 'Sine.Out',
    });
  }

  private hideBuildingPlacementStatusBar(): void {
    if (!this.buildingPlacementStatusBar) {
      return;
    }

    this.tweens.killTweensOf(this.buildingPlacementStatusBar);
    this.buildingPlacementStatusBar.setVisible(false);
  }

  private initializeDecorationPlacementGuide(): void {
    if (this.decorationPlacementGuide) {
      return;
    }

    this.decorationPlacementGuide = this.add.graphics();
    this.decorationPlacementGuide.setVisible(false);
  }

  private initializeBuildingPlacementGuide(): void {
    if (this.buildingPlacementGuide) {
      return;
    }

    this.buildingPlacementGuide = this.add.graphics();
    this.buildingPlacementGuide.setVisible(false);
  }

  private ensureDecorationPlacementNoticeText(): Phaser.GameObjects.Text {
    if (this.decorationPlacementNoticeText) {
      return this.decorationPlacementNoticeText;
    }

    const text = this.add
      .text(0, 0, '', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: '#fee2e2',
        backgroundColor: '#3f1d1d',
        padding: { left: 10, right: 10, top: 5, bottom: 5 },
      })
      .setDepth(DECORATION_PLACEMENT_NOTICE_DEPTH)
      .setScrollFactor(0)
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.decorationPlacementNoticeText = text;
    return text;
  }

  private updateDecorationPlacementNoticePosition(): void {
    const notice = this.decorationPlacementNoticeText;
    if (!notice) {
      return;
    }

    const camera = this.cameras.main;
    notice.setPosition(camera.x + camera.width / 2, camera.y + 16);
  }

  private showDecorationPlacementNotice(message: string): void {
    const normalizedMessage = message.trim();
    if (normalizedMessage.length === 0) {
      return;
    }

    const notice = this.ensureDecorationPlacementNoticeText();
    this.decorationPlacementNoticeTimer?.remove(false);
    this.decorationPlacementNoticeTimer = null;
    notice.setText(normalizedMessage);
    this.updateDecorationPlacementNoticePosition();
    notice.setVisible(true);
    this.decorationPlacementNoticeTimer = this.time.delayedCall(
      DECORATION_PLACEMENT_NOTICE_DURATION_MS,
      () => {
        this.decorationPlacementNoticeTimer = null;
        notice.setVisible(false);
      }
    );
  }

  private clearDecorationPlacementNotice(): void {
    this.decorationPlacementNoticeTimer?.remove(false);
    this.decorationPlacementNoticeTimer = null;
    if (!this.decorationPlacementNoticeText) {
      return;
    }

    this.decorationPlacementNoticeText.setVisible(false).setText('');
  }

  private updateDecorationPlacementGuide(pointer: Phaser.Input.Pointer): void {
    const preview = this.resolveDecorationPlacementPreview(pointer);
    if (!preview) {
      this.clearDecorationPlacementGuide();
      return;
    }

    const guide = this.decorationPlacementGuide;
    if (!guide) {
      return;
    }

    const center = this.tileToWorld(preview.tile.x, preview.tile.y);
    const color = preview.canPlace ? DECORATION_GUIDE_VALID_COLOR : DECORATION_GUIDE_INVALID_COLOR;
    const halfWidth = TILE_WIDTH / 2;
    const halfHeight = TILE_HEIGHT / 2;

    guide.clear();
    guide.fillStyle(color, DECORATION_GUIDE_FILL_ALPHA);
    guide.lineStyle(2, color, DECORATION_GUIDE_STROKE_ALPHA);
    guide.beginPath();
    guide.moveTo(center.x, center.y - halfHeight);
    guide.lineTo(center.x + halfWidth, center.y);
    guide.lineTo(center.x, center.y + halfHeight);
    guide.lineTo(center.x - halfWidth, center.y);
    guide.closePath();
    guide.fillPath();
    guide.strokePath();
    guide.setDepth(center.y + DECORATION_DEPTH_OFFSET - 0.1);
    guide.setVisible(true);
  }

  private clearDecorationPlacementGuide(): void {
    const guide = this.decorationPlacementGuide;
    if (!guide) {
      return;
    }

    guide.clear();
    guide.setVisible(false);
  }

  private updateBuildingPlacementGuide(pointer: Phaser.Input.Pointer): void {
    const preview = this.resolveBuildingPlacementPreview(pointer);
    this.renderBuildingPlacementTileOverlay(preview?.origin ?? null);
    if (!preview) {
      this.clearBuildingPlacementGuide();
      return;
    }

    const guide = this.buildingPlacementGuide;
    if (!guide) {
      return;
    }

    const color = preview.canPlace ? DECORATION_GUIDE_VALID_COLOR : DECORATION_GUIDE_INVALID_COLOR;
    const halfWidth = TILE_WIDTH / 2;
    const halfHeight = TILE_HEIGHT / 2;
    guide.clear();
    guide.fillStyle(color, DECORATION_GUIDE_FILL_ALPHA);
    guide.lineStyle(2, color, DECORATION_GUIDE_STROKE_ALPHA);

    for (let offsetY = 0; offsetY < preview.height; offsetY += 1) {
      for (let offsetX = 0; offsetX < preview.width; offsetX += 1) {
        const center = this.tileToWorld(preview.origin.x + offsetX, preview.origin.y + offsetY);
        guide.beginPath();
        guide.moveTo(center.x, center.y - halfHeight);
        guide.lineTo(center.x + halfWidth, center.y);
        guide.lineTo(center.x, center.y + halfHeight);
        guide.lineTo(center.x - halfWidth, center.y);
        guide.closePath();
        guide.fillPath();
        guide.strokePath();
      }
    }

    const depthAnchor = this.tileToWorld(
      preview.origin.x + (preview.width - 1) / 2,
      preview.origin.y + preview.height
    );
    guide.setDepth(depthAnchor.y + BUILDING_DEPTH_OFFSET - 0.1);
    guide.setVisible(true);
  }

  private clearBuildingPlacementGuide(): void {
    const guide = this.buildingPlacementGuide;
    if (!guide) {
      return;
    }

    guide.clear();
    guide.setVisible(false);
  }

  private clearBuildingPlacementTileOverlay(): void {
    const overlay = this.buildingPlacementTileOverlay;
    if (!overlay) {
      return;
    }

    overlay.clear();
    overlay.setVisible(false);
  }

  private renderBuildingPlacementTileOverlay(hoverOrigin: GridTile | null): void {
    const overlay = this.buildingPlacementTileOverlay;
    if (!overlay) {
      return;
    }

    const buildingType = this.pendingBuildingPlacementType;
    if (buildingType === null) {
      this.clearBuildingPlacementTileOverlay();
      return;
    }

    const placement = this.resolveObstacleBuildingPlacementByType(buildingType);
    if (!placement) {
      this.clearBuildingPlacementTileOverlay();
      return;
    }

    const maxOriginX = Math.max(0, MAP_WIDTH - placement.width);
    const maxOriginY = Math.max(0, MAP_HEIGHT - placement.height);
    const blockedTiles = this.resolveBlockedTilesForBuildingPlacement(placement);
    const halfWidth = TILE_WIDTH / 2;
    const halfHeight = TILE_HEIGHT / 2;

    overlay.clear();
    for (let originY = 0; originY <= maxOriginY; originY += 1) {
      for (let originX = 0; originX <= maxOriginX; originX += 1) {
        const origin = { x: originX, y: originY };
        const evaluation = this.evaluateBuildingPlacementOrigin(origin, placement, blockedTiles);
        const isHovered = hoverOrigin?.x === originX && hoverOrigin?.y === originY;
        const fillColor = evaluation.canPlace
          ? BUILDING_PLACEMENT_TILE_VALID_COLOR
          : BUILDING_PLACEMENT_TILE_INVALID_COLOR;
        const fillAlpha = evaluation.canPlace
          ? isHovered
            ? BUILDING_PLACEMENT_TILE_VALID_HOVER_ALPHA
            : BUILDING_PLACEMENT_TILE_VALID_ALPHA
          : BUILDING_PLACEMENT_TILE_INVALID_ALPHA;
        const strokeColor = evaluation.canPlace
          ? BUILDING_PLACEMENT_TILE_VALID_STROKE_COLOR
          : BUILDING_PLACEMENT_TILE_INVALID_STROKE_COLOR;
        const lineWidth = isHovered ? 1.8 : 1.1;
        const center = this.tileToWorld(originX, originY);

        overlay.fillStyle(fillColor, fillAlpha);
        overlay.lineStyle(lineWidth, strokeColor, evaluation.canPlace ? 0.52 : 0.34);
        overlay.beginPath();
        overlay.moveTo(center.x, center.y - halfHeight);
        overlay.lineTo(center.x + halfWidth, center.y);
        overlay.lineTo(center.x, center.y + halfHeight);
        overlay.lineTo(center.x - halfWidth, center.y);
        overlay.closePath();
        overlay.fillPath();
        overlay.strokePath();
      }
    }

    overlay.setDepth(BUILDING_PLACEMENT_TILE_OVERLAY_DEPTH);
    overlay.setVisible(true);
  }

  private resolveDecorationBaseBlockedTiles(): Set<string> {
    const blockedTiles = this.resolveBlockedTilesFromGameState();
    for (const decoration of this.latestDecorations) {
      blockedTiles.delete(this.toTileKey(decoration.position.x, decoration.position.y));
    }

    return blockedTiles;
  }

  private resolveDecorationPlacementPreview(
    pointer: Phaser.Input.Pointer
  ): DecorationPlacementPreview | null {
    const pointerTile = this.resolvePointerTileForDecorationPlacement(pointer);
    if (!pointerTile) {
      return null;
    }

    const blockedByBuildings = this.resolveDecorationBaseBlockedTiles();
    const pointerTileKey = this.toTileKey(pointerTile.x, pointerTile.y);
    if (blockedByBuildings.has(pointerTileKey)) {
      return {
        tile: pointerTile,
        canPlace: false,
        failureReason: '配置不可（建物と重複）',
      };
    }

    for (const decoration of this.latestDecorations) {
      if (decoration.position.x === pointerTile.x && decoration.position.y === pointerTile.y) {
        return {
          tile: pointerTile,
          canPlace: false,
          failureReason: '配置不可（装飾と重複）',
        };
      }
    }

    return {
      tile: pointerTile,
      canPlace: true,
      failureReason: null,
    };
  }

  private resolveBlockedTilesForBuildingPlacement(currentPlacement: BuildingPlacement): Set<string> {
    const blockedTiles = this.resolveBlockedTilesFromGameState();
    for (let offsetY = 0; offsetY < currentPlacement.height; offsetY += 1) {
      for (let offsetX = 0; offsetX < currentPlacement.width; offsetX += 1) {
        blockedTiles.delete(
          this.toTileKey(currentPlacement.tileX + offsetX, currentPlacement.tileY + offsetY)
        );
      }
    }
    for (const decoration of this.latestDecorations) {
      blockedTiles.add(this.toTileKey(decoration.position.x, decoration.position.y));
    }

    return blockedTiles;
  }

  private evaluateBuildingPlacementOrigin(
    origin: GridTile,
    currentPlacement: BuildingPlacement,
    blockedTiles: ReadonlySet<string>
  ): { canPlace: boolean; failureReason: string | null } {
    for (let offsetY = 0; offsetY < currentPlacement.height; offsetY += 1) {
      for (let offsetX = 0; offsetX < currentPlacement.width; offsetX += 1) {
        const tileX = origin.x + offsetX;
        const tileY = origin.y + offsetY;
        if (!this.isTileInsideMap(tileX, tileY)) {
          return {
            canPlace: false,
            failureReason: '移動不可（地図外）',
          };
        }

        if (blockedTiles.has(this.toTileKey(tileX, tileY))) {
          return {
            canPlace: false,
            failureReason: '移動不可（建物/装飾と重複）',
          };
        }
      }
    }

    return {
      canPlace: true,
      failureReason: null,
    };
  }

  private resolveBuildingPlacementPreview(
    pointer: Phaser.Input.Pointer
  ): BuildingPlacementPreview | null {
    const buildingType = this.pendingBuildingPlacementType;
    if (buildingType === null) {
      return null;
    }

    const currentPlacement = this.resolveObstacleBuildingPlacementByType(buildingType);
    if (!currentPlacement) {
      return null;
    }

    const pointerTile = this.resolvePointerTileForBuildingPlacement(
      pointer,
      currentPlacement.width,
      currentPlacement.height
    );
    if (!pointerTile) {
      return null;
    }

    const blockedTiles = this.resolveBlockedTilesForBuildingPlacement(currentPlacement);
    const evaluation = this.evaluateBuildingPlacementOrigin(pointerTile, currentPlacement, blockedTiles);
    if (!evaluation.canPlace) {
      return {
        origin: pointerTile,
        width: currentPlacement.width,
        height: currentPlacement.height,
        canPlace: false,
        failureReason: evaluation.failureReason,
      };
    }

    return {
      origin: pointerTile,
      width: currentPlacement.width,
      height: currentPlacement.height,
      canPlace: true,
      failureReason: null,
    };
  }

  private resolvePointerTileForDecorationPlacement(pointer: Phaser.Input.Pointer): GridTile | null {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const cart = isoToCart(worldPoint.x - this.mapOrigin.x, worldPoint.y - this.mapOrigin.y);
    if (cart.x < -0.5 || cart.x > MAP_WIDTH - 0.5 || cart.y < -0.5 || cart.y > MAP_HEIGHT - 0.5) {
      return null;
    }

    return {
      x: Phaser.Math.Clamp(Math.round(cart.x), 0, MAP_WIDTH - 1),
      y: Phaser.Math.Clamp(Math.round(cart.y), 0, MAP_HEIGHT - 1),
    };
  }

  private resolvePointerTileForBuildingPlacement(
    pointer: Phaser.Input.Pointer,
    footprintWidth: number,
    footprintHeight: number
  ): GridTile | null {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const cart = isoToCart(worldPoint.x - this.mapOrigin.x, worldPoint.y - this.mapOrigin.y);
    if (cart.x < -0.5 || cart.x > MAP_WIDTH - 0.5 || cart.y < -0.5 || cart.y > MAP_HEIGHT - 0.5) {
      return null;
    }

    const maxOriginX = Math.max(0, MAP_WIDTH - footprintWidth);
    const maxOriginY = Math.max(0, MAP_HEIGHT - footprintHeight);
    return {
      x: Phaser.Math.Clamp(Math.round(cart.x), 0, maxOriginX),
      y: Phaser.Math.Clamp(Math.round(cart.y), 0, maxOriginY),
    };
  }

  private resolveDecorationAtPointer(pointer: Phaser.Input.Pointer): PlacedDecoration | null {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const maxDistance = Math.min(TILE_WIDTH, TILE_HEIGHT) * 0.85;
    const maxDistanceSquared = maxDistance * maxDistance;
    let nearestDecoration: PlacedDecoration | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const decoration of this.latestDecorations) {
      const decorationWorld = this.tileToWorld(decoration.position.x, decoration.position.y);
      const dx = worldPoint.x - decorationWorld.x;
      const dy = worldPoint.y - (decorationWorld.y + DECORATION_CONTAINER_Y_OFFSET);
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > maxDistanceSquared || distanceSquared >= nearestDistanceSquared) {
        continue;
      }

      nearestDecoration = decoration;
      nearestDistanceSquared = distanceSquared;
    }

    return nearestDecoration;
  }

  private getBuildingAnchor(type: BuildingType): Phaser.Math.Vector2 {
    const anchor = this.buildingAnchors.get(type);
    if (anchor) {
      return anchor;
    }

    const fallback = this.tileToWorld(MAP_WIDTH / 2, MAP_HEIGHT / 2);
    return fallback;
  }

  private applyVisibleCameraViewport(): void {
    const camera = this.cameras.main;
    const viewport = this.resolveVisibleViewportSize();
    if (!viewport) {
      camera.setViewport(0, 0, this.scale.width, this.scale.height);
      camera.setSize(this.scale.width, this.scale.height);
      return;
    }

    camera.setViewport(0, 0, viewport.width, viewport.height);
    camera.setSize(viewport.width, viewport.height);
  }

  private resolveVisibleViewportSize(): { width: number; height: number } | null {
    const canvas = this.game.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const relatedRects: DOMRect[] = [canvas.getBoundingClientRect()];
    const panel = canvas.closest('.game-panel');
    const layout = canvas.closest('.main-layout');
    const shell = canvas.closest('.app-shell');

    if (panel instanceof HTMLElement) {
      relatedRects.push(panel.getBoundingClientRect());
    }
    if (layout instanceof HTMLElement) {
      relatedRects.push(layout.getBoundingClientRect());
    }
    if (shell instanceof HTMLElement) {
      relatedRects.push(shell.getBoundingClientRect());
    }

    const left = Math.max(...relatedRects.map((rect) => rect.left));
    const top = Math.max(...relatedRects.map((rect) => rect.top));
    const right = Math.min(...relatedRects.map((rect) => rect.right));
    const bottom = Math.min(...relatedRects.map((rect) => rect.bottom));
    const width = Math.max(1, Math.round(right - left));
    const height = Math.max(1, Math.round(bottom - top));

    if (width <= 1 || height <= 1) {
      return null;
    }

    return { width, height };
  }
}
