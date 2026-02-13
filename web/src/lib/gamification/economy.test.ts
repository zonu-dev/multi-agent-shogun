import { describe, expect, it } from 'vitest';
import { BUILDING_TYPE_ORDER } from '@/game/objects/buildings/BuildingConfig';
import { ITEM_MASTER } from '@/data/item-master';
import type { Decoration } from '@/types';
import {
  addGold,
  applyDropRateBonus,
  applyGoldBonus,
  applyMissionReward,
  applyXpBonus,
  canAffordUpgrade,
  calculatePassiveEffects,
  calculateProduction,
  calculateTaskRewardRate,
  getDecorationPassiveBonus,
  getBuildingUpgradeCost,
  resolveUpgradeCost,
  upgradeBuilding,
} from './economy';

const BUILDING_LEVELS = [1, 2, 3, 4, 5] as const;
const UPGRADE_MATERIAL_IDS = [
  'cedar_lumber',
  'stone_block',
  'tamahagane_ingot',
  'hemp_cloth',
  'sumi_ink',
  'medicinal_herb',
] as const;

describe('economy production and reward rates', () => {
  it('returns finite non-negative production amount for all building types and levels', () => {
    for (const buildingType of BUILDING_TYPE_ORDER) {
      for (const level of BUILDING_LEVELS) {
        const production = calculateProduction(buildingType, level);
        expect(Number.isFinite(production.amount)).toBe(true);
        expect(production.amount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('uses drop table data when calculating production', () => {
    expect(calculateProduction('dojo', 1).amount).toBe(1);
    expect(calculateProduction('dojo', 2).amount).toBe(2);
    expect(calculateProduction('dojo', 3).amount).toBe(3);
    expect(calculateProduction('dojo', 4).amount).toBe(4);
    expect(calculateProduction('dojo', 5).amount).toBe(5);
  });

  it('keeps task reward rate finite and consistent with production', () => {
    for (const buildingType of BUILDING_TYPE_ORDER) {
      for (const level of BUILDING_LEVELS) {
        const production = calculateProduction(buildingType, level);
        const rewardRate = calculateTaskRewardRate(buildingType, level);
        expect(Number.isFinite(rewardRate.goldPerMinute)).toBe(true);
        expect(Number.isFinite(rewardRate.xpPerMinute)).toBe(true);
        expect(rewardRate.goldPerMinute).toBe(production.amount);
        expect(rewardRate.xpPerMinute).toBe(production.amount * 2);
      }
    }
  });

  it('keeps level 4/5 upgrade ROI finite by enforcing high-level production gains', () => {
    const level4UpgradeCost = getBuildingUpgradeCost(3);
    const level5UpgradeCost = getBuildingUpgradeCost(4);
    expect(level4UpgradeCost).not.toBeNull();
    expect(level5UpgradeCost).not.toBeNull();

    if (level4UpgradeCost === null || level5UpgradeCost === null) {
      return;
    }

    for (const buildingType of BUILDING_TYPE_ORDER) {
      const level3GoldRate = calculateTaskRewardRate(buildingType, 3).goldPerMinute;
      const level4GoldRate = calculateTaskRewardRate(buildingType, 4).goldPerMinute;
      const level5GoldRate = calculateTaskRewardRate(buildingType, 5).goldPerMinute;

      expect(level4GoldRate).toBeGreaterThan(level3GoldRate);
      expect(level5GoldRate).toBeGreaterThan(level4GoldRate);

      const roiToLevel4 = level4UpgradeCost / (level4GoldRate - level3GoldRate);
      const roiToLevel5 = level5UpgradeCost / (level5GoldRate - level4GoldRate);

      expect(Number.isFinite(roiToLevel4)).toBe(true);
      expect(Number.isFinite(roiToLevel5)).toBe(true);
      expect(roiToLevel4).toBeGreaterThan(0);
      expect(roiToLevel5).toBeGreaterThan(0);
    }
  });

  it('uses updated generic upgrade costs including expensive level 5 upgrade', () => {
    expect(getBuildingUpgradeCost(3)).toBe(150);
    expect(getBuildingUpgradeCost(4)).toBeGreaterThanOrEqual(600);
  });

  it('keeps client upgrade-material tables in sync for castle/mansion and excludes inn', () => {
    expect(resolveUpgradeCost('inn', 1)).toBeNull();
    expect(resolveUpgradeCost('castle', 4)).toMatchObject({
      gold: 250,
      materials: expect.arrayContaining([
        { itemId: 'stone_block', quantity: 5 },
        { itemId: 'adamantite_fragment', quantity: 2 },
      ]),
    });
    expect(resolveUpgradeCost('mansion', 3)).toMatchObject({
      gold: 150,
      materials: expect.arrayContaining([
        { itemId: 'cedar_lumber', quantity: 3 },
        { itemId: 'hemp_cloth', quantity: 1 },
      ]),
    });
  });

  it('requires materials when upgrading with building context', () => {
    const innUpgrade = upgradeBuilding(1, 500, {
      buildingType: 'inn',
      materials: {},
    });
    expect(innUpgrade.success).toBe(false);

    const missingMaterialResult = upgradeBuilding(1, 500, {
      buildingType: 'castle',
      materials: {
        stone_block: 0,
      },
    });
    expect(missingMaterialResult.success).toBe(false);

    const success = upgradeBuilding(1, 500, {
      buildingType: 'castle',
      materials: {
        stone_block: 1,
      },
    });
    expect(success.success).toBe(true);
    expect(success.spentGold).toBe(50);
    expect(success.remainingGold).toBe(450);
    expect(success.data?.nextLevel).toBe(2);
    expect(success.data?.spentMaterials).toEqual([{ itemId: 'stone_block', quantity: 1 }]);
    expect(canAffordUpgrade({ gold: 49, materials: { stone_block: 1 } }, 'castle', 1)).toBe(false);
  });

  it('reads shogun-seal gold bonus rate from item master dynamically', () => {
    const sealDefinition = ITEM_MASTER.find((item) => item.id === 'shogun_seal');
    expect(sealDefinition?.effect.type).toBe('passive_bonus');
    expect(sealDefinition?.effect.key).toBe('gold_gain_rate');
    const rate =
      sealDefinition?.effect.type === 'passive_bonus' && sealDefinition.effect.key === 'gold_gain_rate'
        ? Math.max(0, sealDefinition.effect.value)
        : 0;
    expect(addGold(100, 200, [{ itemId: 'shogun_seal', quantity: 1 }])).toBe(
      100 + Math.floor((200 * (100 + rate)) / 100)
    );
  });

  it('does not apply shogun-seal bonus twice when mission reward gold is already boosted', () => {
    const rewardGoldWithSeal = addGold(0, 200, [{ itemId: 'shogun_seal', quantity: 1 }]);
    const rewarded = applyMissionReward(
      { level: 1, xp: 0, gold: 40 },
      { xp: 15, gold: rewardGoldWithSeal },
      [{ itemId: 'shogun_seal', quantity: 1 }]
    );
    expect(rewarded.gold).toBe(40 + rewardGoldWithSeal);
    expect(rewarded.xp).toBe(15);
  });

  it('keeps upgrade materials purchasable at low shop rates', () => {
    const itemMap = new Map(ITEM_MASTER.map((item) => [item.id, item]));

    for (const materialId of UPGRADE_MATERIAL_IDS) {
      const item = itemMap.get(materialId);
      expect(item).toBeDefined();

      if (item === undefined) {
        continue;
      }

      expect(item.itemType).toBe('material');
      expect(item.purchasable).toBe(true);
      expect(item.shopCost).toBeGreaterThan(0);
      expect(item.shopCost).toBeLessThanOrEqual(40);
    }
  });
});

describe('decoration passive bonus helpers', () => {
  const manekiNeko = (level: number): Decoration => ({
    id: 'maneki1',
    type: 'maneki_neko',
    level,
    position: { x: 0, y: 0 },
    passiveEffect: { type: 'gold_bonus', bonusPerLevel: 0.05 },
  });

  const komainu = (level: number): Decoration => ({
    id: 'koma1',
    type: 'komainu',
    level,
    position: { x: 0, y: 0 },
    passiveEffect: { type: 'xp_bonus', bonusPerLevel: 0.05 },
  });

  const stoneLantern = (level: number): Decoration => ({
    id: 'ishi1',
    type: 'stone_lantern',
    level,
    position: { x: 0, y: 0 },
    passiveEffect: { type: 'drop_rate_bonus', bonusPerLevel: 0.05 },
  });

  it('calculates decoration bonus multiplier by level', () => {
    expect(getDecorationPassiveBonus([], 'gold_bonus')).toBe(1.0);
    expect(getDecorationPassiveBonus([manekiNeko(1)], 'gold_bonus')).toBeCloseTo(1.05);
    expect(getDecorationPassiveBonus([manekiNeko(3)], 'gold_bonus')).toBeCloseTo(1.15);
    expect(getDecorationPassiveBonus([manekiNeko(5)], 'gold_bonus')).toBeCloseTo(1.25);
  });

  it('applies maneki neko bonus to gold rewards', () => {
    expect(applyGoldBonus(100, [manekiNeko(3)])).toBe(115);
  });

  it('applies komainu bonus to xp rewards', () => {
    expect(applyXpBonus(50, [komainu(2)])).toBe(55);
  });

  it('applies stone lantern bonus to drop rate', () => {
    expect(applyDropRateBonus(0.1, [stoneLantern(5)])).toBeCloseTo(0.125);
  });

  it('sums passive bonuses across placed decorations', () => {
    const summary = calculatePassiveEffects([manekiNeko(2), manekiNeko(3), komainu(4), stoneLantern(1)]);
    expect(summary.goldBonus).toBeCloseTo(25);
    expect(summary.xpBonus).toBeCloseTo(20);
    expect(summary.materialDropBonus).toBeCloseTo(5);
    expect(summary.goldMultiplier).toBeCloseTo(1.25);
  });
});
