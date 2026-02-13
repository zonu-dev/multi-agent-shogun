import {
  BUILDING_CONFIGS,
  clampBuildingLevel,
  type ProductionByLevel,
} from '../../game/objects/buildings/BuildingConfig';
import { ITEM_MASTER } from '../../data/item-master';
import type {
  BuildingLevel,
  BuildingType,
  Decoration,
  Mission,
  TownState,
} from '../../types/game';
import type { InventoryItem } from '../../types/item';

export type DecorationType = 'sakura_tree' | 'stone_lantern' | 'market_stall';

type UpgradeableLevel = 1 | 2 | 3 | 4;

export const BUILDING_UPGRADE_COSTS: Readonly<Record<UpgradeableLevel, number>> = {
  1: 50,
  2: 100,
  3: 150,
  4: 600,
};

export const DECORATION_COSTS: Readonly<Record<DecorationType, number>> = {
  sakura_tree: 60,
  stone_lantern: 45,
  market_stall: 80,
};

export interface EconomyTransactionResult<T = undefined> {
  success: boolean;
  remainingGold: number;
  spentGold: number;
  data?: T;
}

export interface ProductionResult {
  buildingType: BuildingType;
  level: BuildingLevel;
  amount: number;
}

export interface TaskRewardRate {
  buildingType: BuildingType;
  level: BuildingLevel;
  goldPerMinute: number;
  xpPerMinute: number;
}

export interface UpgradeMaterialCost {
  itemId: string;
  quantity: number;
}

export interface UpgradeCost {
  gold: number;
  materials: UpgradeMaterialCost[];
}

export interface PlayerState {
  gold: number;
  materials: Record<string, number>;
}

type BuildingEconomyConfig = {
  productionByLevel?: Partial<Record<BuildingLevel, number>> | readonly ProductionByLevel[];
  rareDropChanceByLevel?: Partial<Record<BuildingLevel, number>>;
  rareDropChance?: number;
  rareDropBonusAtLevel3?: number;
  level3RareDropBonus?: number;
};

type ServerUpgradeBuildingType =
  | 'castle'
  | 'mansion'
  | 'dojo'
  | 'smithy'
  | 'training'
  | 'study'
  | 'healer'
  | 'watchtower'
  | 'scriptorium';

const SHOGUN_SEAL_ITEM_ID = 'shogun_seal';
const SHOGUN_SEAL_GOLD_BONUS_RATE = (() => {
  const item = ITEM_MASTER.find((entry) => entry.id === SHOGUN_SEAL_ITEM_ID);
  if (
    item === undefined ||
    item.effect.type !== 'passive_bonus' ||
    item.effect.key !== 'gold_gain_rate'
  ) {
    return 0;
  }

  return Math.max(0, item.effect.value);
})();
const DEFAULT_LEVEL3_RARE_DROP_BONUS = 0.05;
const DEFAULT_BASE_RARE_DROP_CHANCE = 0;
const DEFAULT_BUILDING_ECONOMY_CONFIG: Readonly<BuildingEconomyConfig> = Object.freeze({});
const XP_PER_GOLD_POINT = 2;
const CURRENCY_UNIT = '両';

const toSafeCurrencyAmount = (amount: number): number => {
  if (!Number.isFinite(amount)) {
    return 0;
  }

  if (amount < 0) {
    return -Math.floor(Math.abs(amount));
  }

  return Math.floor(amount);
};

export const formatCurrency = (amount: number): string =>
  `${toSafeCurrencyAmount(amount).toLocaleString('ja-JP')}${CURRENCY_UNIT}`;

export interface PassiveEffectSummary {
  goldBonus: number;
  xpBonus: number;
  materialDropBonus: number;
  goldMultiplier: number;
  xpMultiplier: number;
  materialDropMultiplier: number;
}

export const calculatePassiveEffects = (
  decorations: readonly Decoration[] = []
): PassiveEffectSummary => {
  const totals = decorations.reduce(
    (acc, decoration) => {
      if (!decoration.position || !decoration.passiveEffect) {
        return acc;
      }

      const level = clampBuildingLevel(
        typeof decoration.level === 'number' && Number.isFinite(decoration.level)
          ? (Math.floor(decoration.level) as BuildingLevel)
          : 1
      );
      const bonusPercent = level * decoration.passiveEffect.bonusPerLevel * 100;
      if (decoration.passiveEffect.type === 'gold_bonus') {
        acc.goldBonus += bonusPercent;
      } else if (decoration.passiveEffect.type === 'xp_bonus') {
        acc.xpBonus += bonusPercent;
      } else if (decoration.passiveEffect.type === 'drop_rate_bonus') {
        acc.materialDropBonus += bonusPercent;
      }

      return acc;
    },
    {
      goldBonus: 0,
      xpBonus: 0,
      materialDropBonus: 0,
    }
  );
  const normalizePercent = (value: number): number => Math.round(value * 1000) / 1000;
  const goldBonus = normalizePercent(totals.goldBonus);
  const xpBonus = normalizePercent(totals.xpBonus);
  const materialDropBonus = normalizePercent(totals.materialDropBonus);

  return {
    goldBonus,
    xpBonus,
    materialDropBonus,
    goldMultiplier: 1 + goldBonus / 100,
    xpMultiplier: 1 + xpBonus / 100,
    materialDropMultiplier: 1 + materialDropBonus / 100,
  };
};

export const getDecorationPassiveBonus = (
  decorations: readonly Decoration[] = [],
  effectType: 'gold_bonus' | 'xp_bonus' | 'drop_rate_bonus'
): number => {
  const summary = calculatePassiveEffects(decorations);
  if (effectType === 'gold_bonus') {
    return summary.goldMultiplier;
  }
  if (effectType === 'xp_bonus') {
    return summary.xpMultiplier;
  }

  return summary.materialDropMultiplier;
};

export const applyGoldBonus = (
  baseGold: number,
  decorations: readonly Decoration[] = []
): number => {
  const bonus = calculatePassiveEffects(decorations);
  return Math.floor((baseGold * Math.round((100 + bonus.goldBonus) * 100)) / 10000);
};

export const applyXpBonus = (baseXp: number, decorations: readonly Decoration[] = []): number =>
  Math.floor(
    (baseXp * Math.round((100 + calculatePassiveEffects(decorations).xpBonus) * 100)) / 10000
  );

export const applyDropRateBonus = (
  baseRate: number,
  decorations: readonly Decoration[] = []
): number => baseRate * calculatePassiveEffects(decorations).materialDropMultiplier;

const toSafeGold = (gold: number): number =>
  Number.isFinite(gold) ? Math.max(0, Math.floor(gold)) : 0;
const toSafeQuantity = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const clampChance = (value: number): number => Math.min(1, Math.max(0, value));
const applyLateLevelProductionFloor = (level: BuildingLevel, amount: number): number => {
  const safeAmount = toSafeQuantity(amount);

  if (level === 4 || level === 5) {
    return Math.max(safeAmount, level);
  }

  return safeAmount;
};

const toUpgradeableLevel = (level: BuildingLevel): UpgradeableLevel | null => {
  if (level === 1 || level === 2 || level === 3 || level === 4) {
    return level;
  }

  return null;
};

const getBuildingEconomyConfig = (buildingType: BuildingType): BuildingEconomyConfig => {
  const config = (BUILDING_CONFIGS as Record<string, unknown>)[buildingType];
  if (typeof config !== 'object' || config === null) {
    return DEFAULT_BUILDING_ECONOMY_CONFIG;
  }

  return config as BuildingEconomyConfig;
};

const resolveProductionAmountFromDropConfig = (
  productionByLevel: readonly ProductionByLevel[],
  level: BuildingLevel
): number => {
  if (productionByLevel.length === 0) {
    return applyLateLevelProductionFloor(level, level);
  }

  const sortedEntries = [...productionByLevel].sort((left, right) => left.level - right.level);
  const exactEntry = sortedEntries.find((entry) => entry.level === level);
  const fallbackEntry =
    [...sortedEntries].reverse().find((entry) => entry.level <= level) ?? sortedEntries[0];
  const selectedEntry = exactEntry ?? fallbackEntry;

  const expectedAmount = selectedEntry.drops.reduce((total, drop) => {
    const min = toSafeQuantity(drop.minQuantity);
    const max = toSafeQuantity(drop.maxQuantity);
    const averageQuantity = (Math.min(min, max) + Math.max(min, max)) / 2;
    return total + averageQuantity * clampChance(drop.chance);
  }, 0);

  return applyLateLevelProductionFloor(level, expectedAmount);
};

const resolveProductionAmount = (buildingType: BuildingType, level: BuildingLevel): number => {
  const config = getBuildingEconomyConfig(buildingType);
  const productionByLevel = config.productionByLevel;

  if (Array.isArray(productionByLevel)) {
    return resolveProductionAmountFromDropConfig(productionByLevel, level);
  }

  if (productionByLevel === undefined) {
    return applyLateLevelProductionFloor(level, level);
  }

  const configuredAmount = (productionByLevel as Partial<Record<BuildingLevel, number>>)[level];
  return applyLateLevelProductionFloor(level, configuredAmount ?? level);
};

const SERVER_UPGRADE_BUILDING_TYPES: readonly ServerUpgradeBuildingType[] = [
  'castle',
  'mansion',
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
];

const isServerUpgradeBuildingType = (
  buildingType: BuildingType
): buildingType is ServerUpgradeBuildingType =>
  (SERVER_UPGRADE_BUILDING_TYPES as readonly BuildingType[]).includes(buildingType);

// 正データは web/server/server-core.ts（UPGRADE_COST_LEVEL_PRESETS / UPGRADE_MATERIAL_PAIR_BY_BUILDING）。
// 本定義はクライアント計算用ミラーであり、サーバーと同値を維持すること。
const UPGRADE_COST_LEVEL_PRESETS: Readonly<
  Record<
    UpgradeableLevel,
    {
      gold: number;
      primary: number;
      secondary: number;
    }
  >
> = {
  1: { gold: 50, primary: 1, secondary: 0 },
  2: { gold: 100, primary: 2, secondary: 0 },
  3: { gold: 150, primary: 3, secondary: 1 },
  4: { gold: 250, primary: 5, secondary: 2 },
};

const UPGRADE_MATERIAL_PAIR_BY_BUILDING: Readonly<
  Record<ServerUpgradeBuildingType, { primary: string; secondary: string }>
> = {
  castle: {
    primary: 'stone_block',
    secondary: 'adamantite_fragment',
  },
  mansion: {
    primary: 'cedar_lumber',
    secondary: 'hemp_cloth',
  },
  dojo: {
    primary: 'tamahagane_ingot',
    secondary: 'hemp_cloth',
  },
  smithy: {
    primary: 'tamahagane_ingot',
    secondary: 'stone_block',
  },
  training: {
    primary: 'cedar_lumber',
    secondary: 'stone_block',
  },
  study: {
    primary: 'sumi_ink',
    secondary: 'cedar_lumber',
  },
  healer: {
    primary: 'medicinal_herb',
    secondary: 'hemp_cloth',
  },
  watchtower: {
    primary: 'stone_block',
    secondary: 'tamahagane_ingot',
  },
  scriptorium: {
    primary: 'sumi_ink',
    secondary: 'hemp_cloth',
  },
};

const UPGRADE_COST_TABLE: Readonly<
  Record<ServerUpgradeBuildingType, Readonly<Record<UpgradeableLevel, UpgradeCost>>>
> = (() => {
  const table = {} as Record<ServerUpgradeBuildingType, Record<UpgradeableLevel, UpgradeCost>>;

  for (const buildingType of SERVER_UPGRADE_BUILDING_TYPES) {
    const pair = UPGRADE_MATERIAL_PAIR_BY_BUILDING[buildingType];
    const byLevel = {} as Record<UpgradeableLevel, UpgradeCost>;

    for (const fromLevel of Object.keys(UPGRADE_COST_LEVEL_PRESETS).map(
      (value) => Number(value) as UpgradeableLevel
    )) {
      const preset = UPGRADE_COST_LEVEL_PRESETS[fromLevel];
      const materials: UpgradeMaterialCost[] = [];

      if (preset.primary > 0) {
        materials.push({
          itemId: pair.primary,
          quantity: preset.primary,
        });
      }
      if (preset.secondary > 0) {
        materials.push({
          itemId: pair.secondary,
          quantity: preset.secondary,
        });
      }

      byLevel[fromLevel] = {
        gold: preset.gold,
        materials,
      };
    }

    table[buildingType] = byLevel;
  }

  return table;
})();

export const resolveUpgradeCost = (
  buildingType: BuildingType,
  currentLevel: BuildingLevel
): UpgradeCost | null => {
  const upgradeLevel = toUpgradeableLevel(currentLevel);
  if (upgradeLevel === null || !isServerUpgradeBuildingType(buildingType)) {
    return null;
  }

  const byLevel = UPGRADE_COST_TABLE[buildingType];
  const cost = byLevel[upgradeLevel];
  if (cost === undefined) {
    return null;
  }

  return {
    gold: cost.gold,
    materials: cost.materials.map((material) => ({
      itemId: material.itemId,
      quantity: material.quantity,
    })),
  };
};

const getOwnedMaterialQuantity = (
  materials: Readonly<Record<string, number>>,
  itemId: string
): number => {
  const value = materials[itemId];
  return typeof value === 'number' && Number.isFinite(value) ? toSafeQuantity(value) : 0;
};

const hasShogunSeal = (inventory: readonly InventoryItem[]): boolean =>
  inventory.some((entry) => entry.itemId === SHOGUN_SEAL_ITEM_ID && entry.quantity > 0);

const applyShogunSealGoldBonus = (amount: number, inventory: readonly InventoryItem[]): number => {
  const safeAmount = Math.max(0, Math.floor(amount));
  if (safeAmount <= 0 || !hasShogunSeal(inventory) || SHOGUN_SEAL_GOLD_BONUS_RATE <= 0) {
    return safeAmount;
  }

  return Math.floor((safeAmount * (100 + SHOGUN_SEAL_GOLD_BONUS_RATE)) / 100);
};

const nextBuildingLevel = (level: BuildingLevel): BuildingLevel | null => {
  if (level === 1) return 2;
  if (level === 2) return 3;
  if (level === 3) return 4;
  if (level === 4) return 5;
  return null;
};

export const getBuildingUpgradeCost = (currentLevel: BuildingLevel): number | null => {
  if (currentLevel === 5) {
    return null;
  }

  return BUILDING_UPGRADE_COSTS[currentLevel];
};

export const calculateProduction = (
  buildingType: BuildingType,
  level: BuildingLevel
): ProductionResult => {
  const normalizedLevel = clampBuildingLevel(level);
  return {
    buildingType,
    level: normalizedLevel,
    amount: resolveProductionAmount(buildingType, normalizedLevel),
  };
};

export const calculateTaskRewardRate = (
  buildingType: BuildingType,
  level: BuildingLevel
): TaskRewardRate => {
  const production = calculateProduction(buildingType, level);
  return {
    buildingType: production.buildingType,
    level: production.level,
    goldPerMinute: production.amount,
    xpPerMinute: production.amount * XP_PER_GOLD_POINT,
  };
};

export const calculateRareDropChance = (
  buildingType: BuildingType,
  level: BuildingLevel
): number => {
  const normalizedLevel = clampBuildingLevel(level);
  const config = getBuildingEconomyConfig(buildingType);
  const configuredBaseChance = config.rareDropChanceByLevel?.[normalizedLevel];
  const baseChance =
    typeof configuredBaseChance === 'number'
      ? configuredBaseChance
      : typeof config.rareDropChance === 'number'
        ? config.rareDropChance
        : DEFAULT_BASE_RARE_DROP_CHANCE;
  const configuredLevel3Bonus =
    typeof config.rareDropBonusAtLevel3 === 'number'
      ? config.rareDropBonusAtLevel3
      : typeof config.level3RareDropBonus === 'number'
        ? config.level3RareDropBonus
        : DEFAULT_LEVEL3_RARE_DROP_BONUS;
  const levelBonus = normalizedLevel === 3 ? configuredLevel3Bonus : 0;

  return clampChance(baseChance + levelBonus);
};

export const canAffordUpgrade = (
  playerState: PlayerState,
  buildingType: BuildingType,
  currentLevel: BuildingLevel
): boolean => {
  const cost = resolveUpgradeCost(buildingType, currentLevel);
  if (cost === null) {
    return false;
  }

  if (!canAfford(playerState.gold, cost.gold)) {
    return false;
  }

  return cost.materials.every(
    (material) =>
      getOwnedMaterialQuantity(playerState.materials, material.itemId) >= material.quantity
  );
};

export const deductUpgradeCost = (
  playerState: PlayerState,
  buildingType: BuildingType,
  currentLevel: BuildingLevel
): PlayerState => {
  const cost = resolveUpgradeCost(buildingType, currentLevel);
  if (cost === null || !canAffordUpgrade(playerState, buildingType, currentLevel)) {
    return playerState;
  }

  const nextMaterials = { ...playerState.materials };
  for (const material of cost.materials) {
    const remaining = Math.max(
      0,
      getOwnedMaterialQuantity(nextMaterials, material.itemId) - material.quantity
    );
    if (remaining <= 0) {
      delete nextMaterials[material.itemId];
      continue;
    }

    nextMaterials[material.itemId] = remaining;
  }

  return {
    ...playerState,
    gold: toSafeGold(playerState.gold) - cost.gold,
    materials: nextMaterials,
  };
};

export const getDecorationCost = (decorationType: DecorationType): number =>
  DECORATION_COSTS[decorationType];

export const canAfford = (gold: number, cost: number): boolean =>
  toSafeGold(gold) >= Math.max(0, Math.floor(cost));

export const addGold = (
  currentGold: number,
  amount: number,
  inventory: readonly InventoryItem[] = []
): number => toSafeGold(currentGold) + applyShogunSealGoldBonus(amount, inventory);

export const spendGold = (currentGold: number, amount: number): EconomyTransactionResult => {
  const safeGold = toSafeGold(currentGold);
  const safeCost = Math.max(0, Math.floor(amount));

  if (safeCost > safeGold) {
    return {
      success: false,
      remainingGold: safeGold,
      spentGold: 0,
    };
  }

  return {
    success: true,
    remainingGold: safeGold - safeCost,
    spentGold: safeCost,
  };
};

export const upgradeBuilding = (
  currentLevel: BuildingLevel,
  currentGold: number,
  options: {
    buildingType?: BuildingType;
    materials?: Readonly<Record<string, number>>;
  } = {}
): EconomyTransactionResult<{
  nextLevel: BuildingLevel;
  spentMaterials?: UpgradeMaterialCost[];
  remainingMaterials?: Record<string, number>;
}> => {
  const nextLevel = nextBuildingLevel(currentLevel);
  const safeGold = toSafeGold(currentGold);

  if (nextLevel === null) {
    return {
      success: false,
      remainingGold: safeGold,
      spentGold: 0,
    };
  }

  if (options.buildingType !== undefined) {
    if (!isServerUpgradeBuildingType(options.buildingType)) {
      return {
        success: false,
        remainingGold: safeGold,
        spentGold: 0,
      };
    }

    const materials = options.materials ?? {};
    const playerState: PlayerState = {
      gold: safeGold,
      materials: { ...materials },
    };
    const upgradeCost = resolveUpgradeCost(options.buildingType, currentLevel);
    if (
      upgradeCost === null ||
      !canAffordUpgrade(playerState, options.buildingType, currentLevel)
    ) {
      return {
        success: false,
        remainingGold: safeGold,
        spentGold: 0,
      };
    }

    const nextPlayerState = deductUpgradeCost(playerState, options.buildingType, currentLevel);
    return {
      success: true,
      remainingGold: nextPlayerState.gold,
      spentGold: upgradeCost.gold,
      data: {
        nextLevel,
        spentMaterials: upgradeCost.materials.map((material) => ({
          itemId: material.itemId,
          quantity: material.quantity,
        })),
        remainingMaterials: nextPlayerState.materials,
      },
    };
  }

  const upgradeCost = getBuildingUpgradeCost(currentLevel);
  if (upgradeCost === null) {
    return {
      success: false,
      remainingGold: safeGold,
      spentGold: 0,
    };
  }

  const tx = spendGold(safeGold, upgradeCost);
  if (!tx.success) {
    return {
      success: false,
      remainingGold: tx.remainingGold,
      spentGold: tx.spentGold,
    };
  }

  return {
    ...tx,
    data: { nextLevel },
  };
};

export const purchaseDecoration = (
  decorationType: DecorationType,
  currentGold: number
): EconomyTransactionResult<{ decorationType: DecorationType }> => {
  const tx = spendGold(currentGold, getDecorationCost(decorationType));

  if (!tx.success) {
    return {
      success: false,
      remainingGold: tx.remainingGold,
      spentGold: tx.spentGold,
    };
  }

  return {
    ...tx,
    data: { decorationType },
  };
};

export const applyMissionReward = (
  town: TownState,
  reward: Mission['reward'],
  _inventory: readonly InventoryItem[] = []
): TownState => ({
  ...town,
  xp: Math.max(0, Math.floor(town.xp)) + Math.max(0, Math.floor(reward.xp)),
  // Mission rewards are expected to include any seal/passive bonus upstream.
  gold: toSafeGold(town.gold) + Math.max(0, Math.floor(reward.gold)),
});
