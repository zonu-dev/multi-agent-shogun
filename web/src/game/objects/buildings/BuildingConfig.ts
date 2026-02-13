import type { BuildingLevel, BuildingType, Position } from '../../../types/game';

export interface BuildingTypeConfig {
  type: BuildingType;
  label: string;
  emoji: string;
  colorHex: `#${string}`;
  color: number;
  defaultLevel: BuildingLevel;
  maxLevel: UpgradeableBuildingLevel;
  upgradeCosts: UpgradeCost[];
  productionByLevel: ProductionByLevel[];
  defaultPosition: Position;
  defaultTilePosition: Position;
  footprint: {
    width: number;
    height: number;
  };
  baseSize: {
    width: number;
    height: number;
  };
  hitArea: BuildingHitAreaConfig;
}

export interface BuildingLevelVisual {
  scale: number;
  brightness: number;
  alpha: number;
  showBorder: boolean;
  borderThickness: number;
  useGradient: boolean;
  showOrnaments: boolean;
  showSparkle: boolean;
}

export interface BuildingTilePlacement {
  type: BuildingType;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
}

export interface BuildingHitAreaConfig {
  scaleX: number;
  scaleY: number;
  minWidth: number;
  minHeight: number;
  priorityBoost: number;
}

export type UpgradeableBuildingLevel = 1 | 2 | 3 | 4 | 5;

export type BuildingMaterialId =
  | 'cedar_lumber'
  | 'stone_block'
  | 'tamahagane_ingot'
  | 'hemp_cloth'
  | 'sumi_ink'
  | 'medicinal_herb'
  | 'adamantite_fragment';

export interface UpgradeCostMaterial {
  itemId: BuildingMaterialId;
  quantity: number;
}

export interface UpgradeCost {
  fromLevel: Exclude<UpgradeableBuildingLevel, 5>;
  toLevel: Exclude<UpgradeableBuildingLevel, 1>;
  gold: number;
  materials: UpgradeCostMaterial[];
}

export interface ProductionDrop {
  itemId: BuildingMaterialId;
  minQuantity: number;
  maxQuantity: number;
  chance: number;
}

export interface ProductionByLevel {
  level: UpgradeableBuildingLevel;
  drops: ProductionDrop[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const clampByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

const combineColor = (r: number, g: number, b: number): number =>
  (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);

const splitColor = (color: number): { r: number; g: number; b: number } => ({
  r: (color >> 16) & 0xff,
  g: (color >> 8) & 0xff,
  b: color & 0xff,
});

const toColorNumber = (hex: `#${string}`): number => Number.parseInt(hex.slice(1), 16);

const createHitAreaConfig = (
  baseSize: { width: number; height: number },
  footprint: { width: number; height: number }
): BuildingHitAreaConfig => {
  const footprintArea = footprint.width * footprint.height;
  const buildingArea = baseSize.width * baseSize.height;
  const minWidth = Math.round(baseSize.width * 0.8);
  const minHeight = Math.round(baseSize.height * 0.8);

  if (footprintArea >= 4) {
    return {
      scaleX: 1.14,
      scaleY: 1.14,
      minWidth,
      minHeight,
      priorityBoost: 0,
    };
  }

  if (buildingArea <= 5200) {
    return {
      scaleX: 1.18,
      scaleY: 1.18,
      minWidth,
      minHeight,
      priorityBoost: 12,
    };
  }

  if (buildingArea <= 6000) {
    return {
      scaleX: 1.16,
      scaleY: 1.16,
      minWidth,
      minHeight,
      priorityBoost: 10,
    };
  }

  if (buildingArea <= 7000) {
    return {
      scaleX: 1.15,
      scaleY: 1.15,
      minWidth,
      minHeight,
      priorityBoost: 8,
    };
  }

  return {
    scaleX: 1.14,
    scaleY: 1.14,
    minWidth,
    minHeight,
    priorityBoost: 6,
  };
};

const createConfig = (
  type: BuildingType,
  label: string,
  emoji: string,
  colorHex: `#${string}`,
  defaultLevel: BuildingLevel,
  maxLevel: UpgradeableBuildingLevel,
  upgradeCosts: UpgradeCost[],
  productionByLevel: ProductionByLevel[],
  defaultPosition: Position,
  defaultTilePosition: Position,
  footprint: { width: number; height: number },
  baseSize: { width: number; height: number }
): BuildingTypeConfig => ({
  type,
  label,
  emoji,
  colorHex,
  color: toColorNumber(colorHex),
  defaultLevel,
  maxLevel,
  upgradeCosts,
  productionByLevel,
  defaultPosition,
  defaultTilePosition,
  footprint,
  baseSize,
  hitArea: createHitAreaConfig(baseSize, footprint),
});

const BUILDING_GRID_WIDTH = 16;
const BUILDING_GRID_HEIGHT = 16;
const BUILDING_PLACEMENT_NEIGHBORS: ReadonlyArray<Position> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const BUILDING_TYPE_ORDER: BuildingType[] = [
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

const DEFAULT_MAX_LEVEL: UpgradeableBuildingLevel = 5;

const MATERIAL = {
  wood: 'cedar_lumber',
  stone: 'stone_block',
  steel: 'tamahagane_ingot',
  cloth: 'hemp_cloth',
  ink: 'sumi_ink',
  herb: 'medicinal_herb',
  adamantite: 'adamantite_fragment',
} as const;

const createUpgradeCosts = (params: {
  level2Gold: number;
  level2Wood: number;
  level3Gold: number;
  level3Wood: number;
  level3Stone: number;
  level3Extras?: UpgradeCostMaterial[];
}): UpgradeCost[] => [
  {
    fromLevel: 1,
    toLevel: 2,
    gold: params.level2Gold,
    materials: [{ itemId: MATERIAL.wood, quantity: params.level2Wood }],
  },
  {
    fromLevel: 2,
    toLevel: 3,
    gold: params.level3Gold,
    materials: [
      { itemId: MATERIAL.wood, quantity: params.level3Wood },
      { itemId: MATERIAL.stone, quantity: params.level3Stone },
      ...(params.level3Extras ?? []),
    ],
  },
];

const createProductionByLevel = (
  primaryMaterial: BuildingMaterialId,
  rareMaterial: BuildingMaterialId
): ProductionByLevel[] => [
  {
    level: 1,
    drops: [
      {
        itemId: primaryMaterial,
        minQuantity: 1,
        maxQuantity: 1,
        chance: 1,
      },
    ],
  },
  {
    level: 2,
    drops: [
      {
        itemId: primaryMaterial,
        minQuantity: 2,
        maxQuantity: 3,
        chance: 1,
      },
    ],
  },
  {
    level: 3,
    drops: [
      {
        itemId: primaryMaterial,
        minQuantity: 3,
        maxQuantity: 4,
        chance: 1,
      },
      {
        itemId: rareMaterial,
        minQuantity: 1,
        maxQuantity: 1,
        chance: 0.22,
      },
    ],
  },
];

const UPGRADE_COSTS_BY_BUILDING: Record<BuildingType, UpgradeCost[]> = {
  castle: createUpgradeCosts({
    level2Gold: 920,
    level2Wood: 56,
    level3Gold: 2240,
    level3Wood: 96,
    level3Stone: 84,
    level3Extras: [{ itemId: MATERIAL.steel, quantity: 8 }],
  }),
  mansion: createUpgradeCosts({
    level2Gold: 640,
    level2Wood: 42,
    level3Gold: 1540,
    level3Wood: 78,
    level3Stone: 64,
    level3Extras: [{ itemId: MATERIAL.cloth, quantity: 10 }],
  }),
  inn: createUpgradeCosts({
    level2Gold: 180,
    level2Wood: 16,
    level3Gold: 460,
    level3Wood: 28,
    level3Stone: 22,
    level3Extras: [{ itemId: MATERIAL.cloth, quantity: 6 }],
  }),
  dojo: createUpgradeCosts({
    level2Gold: 220,
    level2Wood: 18,
    level3Gold: 520,
    level3Wood: 32,
    level3Stone: 24,
    level3Extras: [{ itemId: MATERIAL.steel, quantity: 6 }],
  }),
  smithy: createUpgradeCosts({
    level2Gold: 240,
    level2Wood: 18,
    level3Gold: 560,
    level3Wood: 34,
    level3Stone: 28,
    level3Extras: [{ itemId: MATERIAL.steel, quantity: 8 }],
  }),
  training: createUpgradeCosts({
    level2Gold: 210,
    level2Wood: 18,
    level3Gold: 500,
    level3Wood: 30,
    level3Stone: 24,
    level3Extras: [{ itemId: MATERIAL.cloth, quantity: 5 }],
  }),
  study: createUpgradeCosts({
    level2Gold: 230,
    level2Wood: 18,
    level3Gold: 540,
    level3Wood: 32,
    level3Stone: 25,
    level3Extras: [{ itemId: MATERIAL.ink, quantity: 6 }],
  }),
  healer: createUpgradeCosts({
    level2Gold: 200,
    level2Wood: 17,
    level3Gold: 490,
    level3Wood: 29,
    level3Stone: 23,
    level3Extras: [{ itemId: MATERIAL.herb, quantity: 8 }],
  }),
  watchtower: createUpgradeCosts({
    level2Gold: 220,
    level2Wood: 18,
    level3Gold: 530,
    level3Wood: 32,
    level3Stone: 30,
    level3Extras: [{ itemId: MATERIAL.steel, quantity: 4 }],
  }),
  scriptorium: createUpgradeCosts({
    level2Gold: 210,
    level2Wood: 18,
    level3Gold: 510,
    level3Wood: 30,
    level3Stone: 23,
    level3Extras: [{ itemId: MATERIAL.ink, quantity: 7 }],
  }),
};

const PRODUCTION_BY_BUILDING: Record<BuildingType, ProductionByLevel[]> = {
  castle: createProductionByLevel(MATERIAL.stone, MATERIAL.adamantite),
  mansion: createProductionByLevel(MATERIAL.wood, MATERIAL.cloth),
  inn: createProductionByLevel(MATERIAL.cloth, MATERIAL.herb),
  dojo: createProductionByLevel(MATERIAL.steel, MATERIAL.adamantite),
  smithy: createProductionByLevel(MATERIAL.steel, MATERIAL.adamantite),
  training: createProductionByLevel(MATERIAL.wood, MATERIAL.steel),
  study: createProductionByLevel(MATERIAL.ink, MATERIAL.adamantite),
  healer: createProductionByLevel(MATERIAL.herb, MATERIAL.cloth),
  watchtower: createProductionByLevel(MATERIAL.stone, MATERIAL.steel),
  scriptorium: createProductionByLevel(MATERIAL.ink, MATERIAL.cloth),
};

export const BUILDING_CONFIGS: Record<BuildingType, BuildingTypeConfig> = {
  castle: createConfig(
    'castle',
    'Shogun Castle',
    '🏯',
    '#E8B059',
    5,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.castle,
    PRODUCTION_BY_BUILDING.castle,
    { x: 0, y: -72 },
    { x: 6, y: 7 },
    { width: 2, height: 2 },
    { width: 112, height: 84 }
  ),
  mansion: createConfig(
    'mansion',
    'Karo Mansion',
    '🏠',
    '#60A5FA',
    4,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.mansion,
    PRODUCTION_BY_BUILDING.mansion,
    { x: -96, y: -24 },
    { x: 0, y: 3 },
    { width: 1, height: 1 },
    { width: 94, height: 70 }
  ),
  inn: createConfig(
    'inn',
    'Idle Inn',
    '🏨',
    '#94A3B8',
    2,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.inn,
    PRODUCTION_BY_BUILDING.inn,
    { x: 116, y: -24 },
    { x: 2, y: 9 },
    { width: 1, height: 1 },
    { width: 86, height: 66 }
  ),
  dojo: createConfig(
    'dojo',
    'Implementation Dojo',
    '⚔️',
    '#F87171',
    3,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.dojo,
    PRODUCTION_BY_BUILDING.dojo,
    { x: -154, y: 44 },
    { x: 12, y: 0 },
    { width: 1, height: 1 },
    { width: 84, height: 62 }
  ),
  smithy: createConfig(
    'smithy',
    'Refactoring Smithy',
    '🔨',
    '#FB923C',
    3,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.smithy,
    PRODUCTION_BY_BUILDING.smithy,
    { x: -54, y: 76 },
    { x: 13, y: 9 },
    { width: 1, height: 1 },
    { width: 82, height: 60 }
  ),
  training: createConfig(
    'training',
    'Skill Training',
    '🎯',
    '#A78BFA',
    3,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.training,
    PRODUCTION_BY_BUILDING.training,
    { x: 46, y: 76 },
    { x: 15, y: 4 },
    { width: 1, height: 1 },
    { width: 82, height: 60 }
  ),
  study: createConfig(
    'study',
    'Analysis Study',
    '📚',
    '#2DD4BF',
    3,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.study,
    PRODUCTION_BY_BUILDING.study,
    { x: 146, y: 44 },
    { x: 8, y: 12 },
    { width: 1, height: 1 },
    { width: 84, height: 62 }
  ),
  healer: createConfig(
    'healer',
    'Bug Fix Healer',
    '💊',
    '#4ADE80',
    3,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.healer,
    PRODUCTION_BY_BUILDING.healer,
    { x: -4, y: 142 },
    { x: 5, y: 2 },
    { width: 1, height: 1 },
    { width: 82, height: 60 }
  ),
  watchtower: createConfig(
    'watchtower',
    'Test Watchtower',
    '🗼',
    '#FBBF24',
    3,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.watchtower,
    PRODUCTION_BY_BUILDING.watchtower,
    { x: 96, y: 144 },
    { x: 4, y: 15 },
    { width: 1, height: 1 },
    { width: 76, height: 78 }
  ),
  scriptorium: createConfig(
    'scriptorium',
    'Scriptorium',
    '📜',
    '#C08457',
    3,
    DEFAULT_MAX_LEVEL,
    UPGRADE_COSTS_BY_BUILDING.scriptorium,
    PRODUCTION_BY_BUILDING.scriptorium,
    { x: 196, y: 110 },
    { x: 12, y: 15 },
    { width: 1, height: 1 },
    { width: 86, height: 64 }
  ),
};

export const BUILDING_LEVEL_VISUALS: Record<BuildingLevel, BuildingLevelVisual> = {
  1: {
    scale: 0.72,
    brightness: 0.6,
    alpha: 0.84,
    showBorder: false,
    borderThickness: 0,
    useGradient: false,
    showOrnaments: false,
    showSparkle: false,
  },
  2: {
    scale: 0.88,
    brightness: 0.8,
    alpha: 0.92,
    showBorder: false,
    borderThickness: 0,
    useGradient: false,
    showOrnaments: false,
    showSparkle: false,
  },
  3: {
    scale: 1,
    brightness: 1,
    alpha: 1,
    showBorder: true,
    borderThickness: 2,
    useGradient: false,
    showOrnaments: false,
    showSparkle: false,
  },
  4: {
    scale: 1.16,
    brightness: 1.08,
    alpha: 1,
    showBorder: true,
    borderThickness: 2,
    useGradient: true,
    showOrnaments: true,
    showSparkle: false,
  },
  5: {
    scale: 1.28,
    brightness: 1.15,
    alpha: 1,
    showBorder: true,
    borderThickness: 3,
    useGradient: true,
    showOrnaments: true,
    showSparkle: true,
  },
};

export const clampBuildingLevel = (level: number): BuildingLevel => {
  const safeLevel = Math.round(level);

  if (!Number.isFinite(safeLevel) || safeLevel <= 1) {
    return 1;
  }

  if (safeLevel >= 5) {
    return 5;
  }

  return safeLevel as BuildingLevel;
};

export const getBuildingConfig = (type: BuildingType): BuildingTypeConfig => BUILDING_CONFIGS[type];

export const getBuildingLevelVisual = (level: BuildingLevel): BuildingLevelVisual =>
  BUILDING_LEVEL_VISUALS[level];

const toTileKey = (tileX: number, tileY: number): string => `${tileX},${tileY}`;

const clampTileOrigin = (
  position: Position,
  footprint: { width: number; height: number }
): Position => {
  const maxX = Math.max(0, BUILDING_GRID_WIDTH - footprint.width);
  const maxY = Math.max(0, BUILDING_GRID_HEIGHT - footprint.height);

  return {
    x: Math.min(Math.max(Math.floor(position.x), 0), maxX),
    y: Math.min(Math.max(Math.floor(position.y), 0), maxY),
  };
};

const canPlaceFootprint = (
  origin: Position,
  footprint: { width: number; height: number },
  occupiedTiles: Set<string>
): boolean => {
  for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
    for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
      const tileX = origin.x + offsetX;
      const tileY = origin.y + offsetY;
      if (tileX < 0 || tileX >= BUILDING_GRID_WIDTH || tileY < 0 || tileY >= BUILDING_GRID_HEIGHT) {
        return false;
      }
      if (occupiedTiles.has(toTileKey(tileX, tileY))) {
        return false;
      }
    }
  }

  return true;
};

const reserveFootprint = (
  origin: Position,
  footprint: { width: number; height: number },
  occupiedTiles: Set<string>
): void => {
  for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
    for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
      occupiedTiles.add(toTileKey(origin.x + offsetX, origin.y + offsetY));
    }
  }
};

const resolveNearestAvailableTile = (
  requested: Position,
  footprint: { width: number; height: number },
  occupiedTiles: Set<string>
): Position | null => {
  const origin = clampTileOrigin(requested, footprint);
  if (canPlaceFootprint(origin, footprint, occupiedTiles)) {
    return origin;
  }

  const queue: Position[] = [origin];
  const visited = new Set<string>([toTileKey(origin.x, origin.y)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const offset of BUILDING_PLACEMENT_NEIGHBORS) {
      const candidate = clampTileOrigin(
        { x: current.x + offset.x, y: current.y + offset.y },
        footprint
      );
      const key = toTileKey(candidate.x, candidate.y);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      if (canPlaceFootprint(candidate, footprint, occupiedTiles)) {
        return candidate;
      }

      queue.push(candidate);
    }
  }

  return null;
};

export const normalizeBuildingTilePlacements = (
  requestedByType: Partial<Record<BuildingType, Position>>
): BuildingTilePlacement[] => {
  const occupiedTiles = new Set<string>();
  const placements: BuildingTilePlacement[] = [];

  for (const type of BUILDING_TYPE_ORDER) {
    const config = BUILDING_CONFIGS[type];
    const requested =
      type === 'castle'
        ? config.defaultTilePosition
        : (requestedByType[type] ?? config.defaultTilePosition);
    const origin =
      resolveNearestAvailableTile(requested, config.footprint, occupiedTiles) ??
      resolveNearestAvailableTile(config.defaultTilePosition, config.footprint, occupiedTiles);

    if (!origin) {
      continue;
    }

    reserveFootprint(origin, config.footprint, occupiedTiles);
    placements.push({
      type,
      tileX: origin.x,
      tileY: origin.y,
      width: config.footprint.width,
      height: config.footprint.height,
    });
  }

  return placements;
};

export const scaleColorBrightness = (color: number, brightness: number): number => {
  const { r, g, b } = splitColor(color);

  return combineColor(r * brightness, g * brightness, b * brightness);
};

export const mixColors = (fromColor: number, toColor: number, ratio: number): number => {
  const clampedRatio = clamp01(ratio);
  const from = splitColor(fromColor);
  const to = splitColor(toColor);

  return combineColor(
    from.r + (to.r - from.r) * clampedRatio,
    from.g + (to.g - from.g) * clampedRatio,
    from.b + (to.b - from.b) * clampedRatio
  );
};
