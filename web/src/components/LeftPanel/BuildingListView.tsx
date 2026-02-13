import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILDING_CONFIGS, BUILDING_TYPE_ORDER } from '@/game/objects/buildings/BuildingConfig';
import {
  calculateTaskRewardRate,
  resolveUpgradeCost,
  type UpgradeCost,
} from '@/lib/gamification/economy';
import { selectInventory, useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';
import {
  TASK_TO_BUILDING_MAP,
  type Building,
  type BuildingType,
  type Decoration,
  type GameState,
  type InventoryItem,
  type TaskCategory,
} from '@/types';
import { showOperationNotice, type OperationNoticeTone } from '@/lib/ui/operationNotice';

interface UpgradeBuildingApiResponse {
  success?: boolean;
  error?: string;
  gameState?: unknown;
  missingGold?: unknown;
  missing?: unknown;
}

interface MoveBuildingApiResponse {
  success?: boolean;
  error?: string;
  gameState?: unknown;
}

interface BuildingPlacementCommitDetail {
  buildingId?: string;
  mode?: 'move';
  position?: {
    x?: number;
    y?: number;
  };
}

interface BuildingPlacementStartDetail {
  buildingId?: string;
  mode?: 'move';
}

interface BuildingPlacementCancelDetail {
  buildingId?: string;
  message?: string;
}

interface PendingBuildingMove {
  buildingId: BuildingType;
}

type ClassifiedTaskCategory = Exclude<TaskCategory, 'idle' | 'other'>;
type UpgradeStateVocabulary = '不足' | '対象外' | '上限到達' | '改築可';
type UpgradeBlockReason =
  | 'none'
  | 'max_level'
  | 'unsupported'
  | 'gold_shortage'
  | 'material_shortage'
  | 'gold_and_material_shortage';

interface UpgradeMaterialRequirementGap {
  itemId: string;
  name: string;
  required: number;
  owned: number;
}

interface UpgradeAvailability {
  canUpgrade: boolean;
  vocabulary: UpgradeStateVocabulary;
  blockReason: UpgradeBlockReason;
  buttonLabel: string;
}

const BUILDING_NAME_BY_TYPE: Record<BuildingType, string> = {
  castle: '天守',
  mansion: '屋敷',
  inn: '宿屋',
  dojo: '道場',
  smithy: '鍛冶屋',
  training: '訓練所',
  study: '学問所',
  healer: '薬師',
  watchtower: '物見櫓',
  scriptorium: '写本所',
};

const FALLBACK_EMOJI_BY_TYPE: Record<BuildingType, string> = {
  castle: '🏯',
  mansion: '🏠',
  inn: '🏨',
  dojo: '⚔️',
  smithy: '🔨',
  training: '🏋️',
  study: '📚',
  healer: '💊',
  watchtower: '🗼',
  scriptorium: '📜',
};

const MATERIAL_NAME_BY_ID: Record<string, string> = {
  cedar_lumber: '杉材',
  stone_block: '石材',
  tamahagane_ingot: '玉鋼片',
  hemp_cloth: '麻布',
  sumi_ink: '松煙墨',
  medicinal_herb: '薬草束',
  adamantite_fragment: '黒鉄片',
};

const TASK_CATEGORY_LABELS: Record<ClassifiedTaskCategory, string> = {
  new_implementation: '新規実装',
  refactoring: 'リファクタリング',
  skill_creation: 'スキル作成',
  analysis: '分析',
  bug_fix: 'バグ修正',
  docs: '文書',
  test: '検証',
};

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const DECORATION_INVENTORY_PLACE_REQUEST_EVENT = 'shogun:decoration-inventory-place:request';
const BUILDING_PLACEMENT_START_EVENT = 'shogun:building-placement:start';
const BUILDING_PLACEMENT_COMMIT_EVENT = 'shogun:building-placement:commit';
const BUILDING_PLACEMENT_CANCEL_EVENT = 'shogun:building-placement:cancel';
const ACTION_BUTTON_BASE_CLASS = 'rounded-md border px-2.5 py-1 text-xs font-semibold transition';
const ACTION_BUTTON_DISABLED_CLASS = 'cursor-not-allowed border-slate-500/50 bg-slate-500/20 text-slate-300';
const ACTION_BUTTON_PRIMARY_CLASS =
  'border-[color:var(--kincha)]/65 bg-[color:var(--kincha)]/80 text-[#3d2200] hover:bg-[color:var(--kincha)]/95';
const ACTION_BUTTON_OUTLINE_CLASS =
  'border-[color:var(--kincha)]/45 bg-[color:var(--kincha)]/20 text-[color:var(--kincha)] hover:bg-[color:var(--kincha)]/30';
const DECORATION_META: Record<string, { emoji: string; label: string; color: string }> = {
  maneki_neko: { emoji: '🐈', label: '招き猫', color: '#f59e0b' },
  komainu: { emoji: '🦁', label: '狛犬', color: '#38bdf8' },
  ishidoro: { emoji: '🏮', label: '石灯籠', color: '#f59e0b' },
  sakura_tree: { emoji: '🌸', label: '桜の木', color: '#f472b6' },
  stone_lantern: { emoji: '🏮', label: '石灯籠', color: '#f59e0b' },
  market_stall: { emoji: '🏪', label: '市場屋台', color: '#38bdf8' },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

interface UpgradeMissingMaterialEntry {
  name: string;
  shortfall: number;
}

const isGameStatePayload = (value: unknown): value is GameState =>
  isRecord(value) &&
  Array.isArray(value.ashigaru) &&
  Array.isArray(value.buildings) &&
  isRecord(value.town) &&
  isRecord(value.economy) &&
  Array.isArray(value.inventory) &&
  Array.isArray(value.decorations) &&
  Array.isArray(value.missions) &&
  Array.isArray(value.activityLog);

const toSafeInteger = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const toSafeIntegerFromUnknown = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;

const toBuildingType = (value: unknown): BuildingType | null =>
  typeof value === 'string' && BUILDING_TYPE_ORDER.includes(value as BuildingType)
    ? (value as BuildingType)
    : null;

const toUpgradeMissingMaterialEntry = (value: unknown): UpgradeMissingMaterialEntry | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const nameFromPayload = typeof value.name === 'string' ? value.name.trim() : '';
  const required = toSafeIntegerFromUnknown(value.required) ?? 0;
  const have = toSafeIntegerFromUnknown(value.have) ?? 0;
  const shortfall = Math.max(0, required - have);
  if (shortfall <= 0) {
    return null;
  }

  const resolvedName =
    nameFromPayload.length > 0 ? nameFromPayload : id.length > 0 ? MATERIAL_NAME_BY_ID[id] ?? id : '素材';

  return {
    name: resolvedName,
    shortfall,
  };
};

const resolveUpgradeFailureMessage = (payload: UpgradeBuildingApiResponse | null): string => {
  const errorText = typeof payload?.error === 'string' ? payload.error.trim() : '';
  const missingGold = toSafeIntegerFromUnknown(payload?.missingGold) ?? 0;
  const missingMaterials = Array.isArray(payload?.missing)
    ? payload.missing
        .map((entry) => toUpgradeMissingMaterialEntry(entry))
        .filter((entry): entry is UpgradeMissingMaterialEntry => entry !== null)
    : [];

  if (errorText === '素材不足') {
    if (missingMaterials.length > 0) {
      const detail = missingMaterials.map((material) => `${material.name} ${material.shortfall}`).join(' / ');
      return `素材が不足しておる（${detail}）`;
    }

    return '素材が不足しておる。';
  }

  if (errorText === 'ゴールド不足') {
    return missingGold > 0 ? `小判が足りぬ（あと${missingGold}両）。` : '小判が足りぬ。';
  }

  if (missingGold > 0 && missingMaterials.length > 0) {
    const detail = missingMaterials.map((material) => `${material.name} ${material.shortfall}`).join(' / ');
    return `小判が足りぬ（あと${missingGold}両）。素材が不足しておる（${detail}）。`;
  }

  if (missingGold > 0) {
    return `小判が足りぬ（あと${missingGold}両）。`;
  }

  if (missingMaterials.length > 0) {
    const detail = missingMaterials.map((material) => `${material.name} ${material.shortfall}`).join(' / ');
    return `素材が不足しておる（${detail}）。`;
  }

  return errorText.length > 0 ? errorText : '改築に失敗いたした。時をおいて再試行されよ。';
};

const resolveMoveBuildingFailureMessage = (payload: MoveBuildingApiResponse | null): string => {
  const errorText = typeof payload?.error === 'string' ? payload.error.trim() : '';
  return errorText.length > 0 ? errorText : '建物移動に失敗いたした。時をおいて再試行されよ。';
};

const hasPlacedDecorationPosition = (decoration: Decoration): boolean =>
  typeof decoration.position?.x === 'number' &&
  Number.isFinite(decoration.position.x) &&
  typeof decoration.position?.y === 'number' &&
  Number.isFinite(decoration.position.y);

const toInventoryAmountByItemId = (inventory: readonly InventoryItem[]): Record<string, number> => {
  return inventory.reduce<Record<string, number>>((acc, entry) => {
    const itemId = typeof entry.itemId === 'string' ? entry.itemId : '';
    if (itemId.length === 0) {
      return acc;
    }

    const quantity = toSafeInteger(entry.quantity);
    acc[itemId] = (acc[itemId] ?? 0) + quantity;
    return acc;
  }, {});
};

const formatUpgradeCostText = (cost: UpgradeCost): string => {
  const materialText = cost.materials
    .map((material) => `${MATERIAL_NAME_BY_ID[material.itemId] ?? material.itemId}×${material.quantity}`)
    .join(' / ');

  return materialText.length > 0 ? `${cost.gold}両 + ${materialText}` : `${cost.gold}両`;
};

const toUpgradeMaterialRequirementGap = (
  material: UpgradeCost['materials'][number],
  amountByItemId: Record<string, number>
): UpgradeMaterialRequirementGap | null => {
  const required = toSafeInteger(material.quantity);
  const owned = toSafeInteger(amountByItemId[material.itemId] ?? 0);
  if (owned >= required) {
    return null;
  }

  return {
    itemId: material.itemId,
    name: MATERIAL_NAME_BY_ID[material.itemId] ?? material.itemId,
    required,
    owned,
  };
};

const resolveUpgradeAvailability = ({
  isBusy,
  isMaxLevel,
  hasGold,
  missingMaterialCount,
  upgradeCost,
}: {
  isBusy: boolean;
  isMaxLevel: boolean;
  hasGold: boolean;
  missingMaterialCount: number;
  upgradeCost: UpgradeCost | null;
}): UpgradeAvailability => {
  if (isBusy) {
    return {
      canUpgrade: false,
      vocabulary: '改築可',
      blockReason: 'none',
      buttonLabel: '改築中...',
    };
  }

  if (isMaxLevel) {
    return {
      canUpgrade: false,
      vocabulary: '上限到達',
      blockReason: 'max_level',
      buttonLabel: 'レベル上限',
    };
  }

  if (upgradeCost === null) {
    return {
      canUpgrade: false,
      vocabulary: '対象外',
      blockReason: 'unsupported',
      buttonLabel: '対象外',
    };
  }

  if (!hasGold && missingMaterialCount > 0) {
    return {
      canUpgrade: false,
      vocabulary: '不足',
      blockReason: 'gold_and_material_shortage',
      buttonLabel: '資材不足',
    };
  }

  if (!hasGold) {
    return {
      canUpgrade: false,
      vocabulary: '不足',
      blockReason: 'gold_shortage',
      buttonLabel: '小判不足',
    };
  }

  if (missingMaterialCount > 0) {
    return {
      canUpgrade: false,
      vocabulary: '不足',
      blockReason: 'material_shortage',
      buttonLabel: '素材不足',
    };
  }

  return {
    canUpgrade: true,
    vocabulary: '改築可',
    blockReason: 'none',
    buttonLabel: '改築',
  };
};

const resolveUpgradeStateClassName = (vocabulary: UpgradeStateVocabulary): string => {
  if (vocabulary === '上限到達') {
    return 'text-emerald-200/90';
  }

  if (vocabulary === '対象外') {
    return 'text-slate-300/95';
  }

  if (vocabulary === '不足') {
    return 'text-rose-200/90';
  }

  return 'text-emerald-200/90';
};

const buildUpgradeDetailMessages = ({
  vocabulary,
  blockReason,
  upgradeCost,
  currentGold,
  missingMaterials,
}: {
  vocabulary: UpgradeStateVocabulary;
  blockReason: UpgradeBlockReason;
  upgradeCost: UpgradeCost | null;
  currentGold: number;
  missingMaterials: readonly UpgradeMaterialRequirementGap[];
}): string[] => {
  if (vocabulary === '上限到達') {
    return ['建物レベルは既に上限に達しておる。'];
  }

  if (vocabulary === '対象外') {
    return ['改築情報が未登録の建物ゆえ、対象外でござる。'];
  }

  if (vocabulary !== '不足' || upgradeCost === null) {
    return [];
  }

  const details: string[] = [];
  if (blockReason === 'gold_shortage' || blockReason === 'gold_and_material_shortage') {
    details.push(`小判が不足（必要${upgradeCost.gold}/所持${toSafeInteger(currentGold)}）`);
  }

  if (blockReason === 'material_shortage' || blockReason === 'gold_and_material_shortage') {
    details.push(
      ...missingMaterials.map(
        (material) => `${material.name}が不足（必要${material.required}/所持${material.owned}）`
      )
    );
  }

  return details;
};

const UPGRADE_COST_LEVEL_PRESETS = {
  1: { gold: 50, primary: 1, secondary: 0 },
  2: { gold: 100, primary: 2, secondary: 0 },
  3: { gold: 200, primary: 3, secondary: 1 },
  4: { gold: 400, primary: 5, secondary: 2 },
} as const;

const FALLBACK_UPGRADE_MATERIAL_PAIR_BY_BUILDING: Partial<
  Record<BuildingType, { primary: string; secondary: string }>
> = {
  castle: {
    primary: 'stone_block',
    secondary: 'adamantite_fragment',
  },
  mansion: {
    primary: 'cedar_lumber',
    secondary: 'hemp_cloth',
  },
  inn: {
    primary: 'hemp_cloth',
    secondary: 'medicinal_herb',
  },
};

const resolveFallbackUpgradeCost = (
  buildingType: BuildingType,
  currentLevel: Building['level']
): UpgradeCost | null => {
  const pair = FALLBACK_UPGRADE_MATERIAL_PAIR_BY_BUILDING[buildingType];
  if (pair === undefined) {
    return null;
  }

  if (currentLevel !== 1 && currentLevel !== 2 && currentLevel !== 3 && currentLevel !== 4) {
    return null;
  }

  const preset = UPGRADE_COST_LEVEL_PRESETS[currentLevel];
  const materials: UpgradeCost['materials'] = [];
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

  return {
    gold: preset.gold,
    materials,
  };
};

const resolveBuildingUpgradeCost = (
  buildingType: BuildingType,
  currentLevel: Building['level']
): UpgradeCost | null => {
  const mirroredCost = resolveUpgradeCost(buildingType, currentLevel);
  if (mirroredCost !== null) {
    return mirroredCost;
  }

  return resolveFallbackUpgradeCost(buildingType, currentLevel);
};

const BUILDING_TASK_CATEGORY_MAP: Partial<Record<BuildingType, ClassifiedTaskCategory>> = (() => {
  const mapping: Partial<Record<BuildingType, ClassifiedTaskCategory>> = {};

  for (const [category, buildingType] of Object.entries(TASK_TO_BUILDING_MAP) as Array<
    [TaskCategory, BuildingType]
  >) {
    if (category === 'idle' || category === 'other') {
      continue;
    }

    if (mapping[buildingType] === undefined) {
      mapping[buildingType] = category as ClassifiedTaskCategory;
    }
  }

  return mapping;
})();

const BuildingListView = () => {
  const gameState = useGameStore((state) => state.gameState);
  const inventory = useGameStore(selectInventory);
  const updateGameState = useGameStore((state) => state.updateGameState);
  const openPopup = useUIStore((state) => state.openPopup);
  const [upgradingBuildingType, setUpgradingBuildingType] = useState<BuildingType | null>(null);
  const [pendingBuildingMove, setPendingBuildingMove] = useState<PendingBuildingMove | null>(null);
  const [movingBuildingType, setMovingBuildingType] = useState<BuildingType | null>(null);

  const notifyOperation = useCallback(
    (message: string, tone: OperationNoticeTone = 'info') => {
      showOperationNotice(openPopup, message, { tone });
    },
    [openPopup]
  );

  const currentGold = gameState?.town.gold ?? 0;
  const amountByItemId = useMemo(() => toInventoryAmountByItemId(inventory), [inventory]);

  const dropMaterialNamesByBuildingType = useMemo(() => {
    return BUILDING_TYPE_ORDER.reduce<Record<BuildingType, string[]>>((acc, buildingType) => {
      const seen = new Set<string>();
      const names: string[] = [];

      for (const production of BUILDING_CONFIGS[buildingType].productionByLevel) {
        for (const drop of production.drops) {
          if (seen.has(drop.itemId)) {
            continue;
          }

          seen.add(drop.itemId);
          names.push(MATERIAL_NAME_BY_ID[drop.itemId] ?? drop.itemId);
        }
      }

      acc[buildingType] = names;
      return acc;
    }, {} as Record<BuildingType, string[]>);
  }, []);

  const buildings = useMemo<Building[]>(() => {
    const stateBuildings = gameState?.buildings ?? [];
    const byType = new Map<BuildingType, Building>();

    for (const building of stateBuildings) {
      byType.set(building.type, building);
    }

    return BUILDING_TYPE_ORDER.map((type) => {
      const existing = byType.get(type);
      if (existing) {
        return existing;
      }

      return {
        type,
        level: BUILDING_CONFIGS[type].defaultLevel,
        position: BUILDING_CONFIGS[type].defaultPosition,
      };
    });
  }, [gameState?.buildings]);

  const decorationStockByType = useMemo(() => {
    const decorations = gameState?.decorations ?? [];
    return decorations.reduce<Record<string, { total: number; unplaced: number }>>((acc, decoration) => {
      const decorationType =
        typeof decoration.type === 'string' && decoration.type.trim().length > 0
          ? decoration.type
          : 'unknown';
      if (acc[decorationType] === undefined) {
        acc[decorationType] = {
          total: 0,
          unplaced: 0,
        };
      }

      const current = acc[decorationType];
      if (!current) {
        return acc;
      }

      current.total += 1;
      if (!hasPlacedDecorationPosition(decoration)) {
        current.unplaced += 1;
      }
      return acc;
    }, {});
  }, [gameState?.decorations]);

  const decorationEntries = useMemo(() => {
    const knownTypes = Object.keys(DECORATION_META);
    const extraTypes = Object.keys(decorationStockByType).filter((type) => !knownTypes.includes(type));
    const orderedTypes = [...knownTypes, ...extraTypes];

    return orderedTypes
      .filter((type) => {
        const stock = decorationStockByType[type];
        return typeof stock?.unplaced === 'number' && stock.unplaced > 0;
      })
      .map((type) => ({
        type,
        unplaced: decorationStockByType[type]?.unplaced ?? 0,
        meta: DECORATION_META[type] ?? {
          emoji: '🧩',
          label: type,
          color: '#94a3b8',
        },
      }));
  }, [decorationStockByType]);

  const buildingsRef = useRef<Building[]>(buildings);
  const pendingBuildingMoveRef = useRef<PendingBuildingMove | null>(pendingBuildingMove);
  const movingBuildingTypeRef = useRef<BuildingType | null>(movingBuildingType);
  const upgradingBuildingTypeRef = useRef<BuildingType | null>(upgradingBuildingType);
  const notifyOperationRef = useRef(notifyOperation);
  const updateGameStateRef = useRef(updateGameState);

  buildingsRef.current = buildings;
  pendingBuildingMoveRef.current = pendingBuildingMove;
  movingBuildingTypeRef.current = movingBuildingType;
  upgradingBuildingTypeRef.current = upgradingBuildingType;
  notifyOperationRef.current = notifyOperation;
  updateGameStateRef.current = updateGameState;

  const handlePlaceDecoration = (decorationType: string): void => {
    if (typeof window === 'undefined') {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(DECORATION_INVENTORY_PLACE_REQUEST_EVENT, {
        detail: {
          decorationType,
        },
      })
    );
  };

  const handleUpgrade = async (buildingType: BuildingType): Promise<void> => {
    if (upgradingBuildingType !== null) {
      return;
    }

    setUpgradingBuildingType(buildingType);

    try {
      const response = await fetch('/api/upgrade-building', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ buildingId: buildingType }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as UpgradeBuildingApiResponse | null;

      if (!response.ok || payload?.success !== true || !isGameStatePayload(payload.gameState)) {
        notifyOperation(resolveUpgradeFailureMessage(payload), 'error');
        return;
      }

      updateGameState(payload.gameState);
      notifyOperation(`${BUILDING_NAME_BY_TYPE[buildingType]}を改築いたした。`, 'success');
    } catch {
      notifyOperation('改築に失敗いたした。通信が乱れた。', 'error');
    } finally {
      setUpgradingBuildingType(null);
    }
  };

  const handleMoveBuilding = useCallback(
    (buildingType: BuildingType): void => {
      if (typeof window === 'undefined') {
        return;
      }
      window.dispatchEvent(
        new CustomEvent(BUILDING_PLACEMENT_START_EVENT, {
          detail: {
            buildingId: buildingType,
            mode: 'move' as const,
          },
        })
      );
    },
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStart = (event: Event): void => {
      const detail = (event as CustomEvent<BuildingPlacementStartDetail>).detail;
      const buildingType = toBuildingType(detail?.buildingId);
      if (buildingType === null || detail?.mode !== 'move') {
        return;
      }

      const currentPending = pendingBuildingMoveRef.current;
      if (currentPending !== null) {
        if (currentPending.buildingId !== buildingType) {
          const message = '既に建物の移動先を選択中でござる。';
          notifyOperationRef.current(message, 'error');
          window.dispatchEvent(
            new CustomEvent(BUILDING_PLACEMENT_CANCEL_EVENT, {
              detail: {
                buildingId: buildingType,
                message,
              },
            })
          );
        }
        return;
      }

      if (movingBuildingTypeRef.current !== null || upgradingBuildingTypeRef.current !== null) {
        const message = '既に建物の移動先を選択中でござる。';
        notifyOperationRef.current(message, 'error');
        window.dispatchEvent(
          new CustomEvent(BUILDING_PLACEMENT_CANCEL_EVENT, {
            detail: {
              buildingId: buildingType,
              message,
            },
          })
        );
        return;
      }

      const currentBuilding = buildingsRef.current.find((entry) => entry.type === buildingType);
      const originSource = currentBuilding?.position ?? BUILDING_CONFIGS[buildingType].defaultPosition;
      const hasOrigin = Number.isFinite(originSource.x) && Number.isFinite(originSource.y);
      if (!hasOrigin) {
        const message = '建物の現在座標が不正でござる。';
        notifyOperationRef.current(message, 'error');
        window.dispatchEvent(
          new CustomEvent(BUILDING_PLACEMENT_CANCEL_EVENT, {
            detail: {
              buildingId: buildingType,
              message,
            },
          })
        );
        return;
      }

      const nextPending: PendingBuildingMove = {
        buildingId: buildingType,
      };
      pendingBuildingMoveRef.current = nextPending;
      setPendingBuildingMove(nextPending);
      notifyOperationRef.current(`${BUILDING_NAME_BY_TYPE[buildingType]}の移動先を地図で選ぶでござる。`);
    };

    const handleCommit = (event: Event): void => {
      const currentPending = pendingBuildingMoveRef.current;
      if (!currentPending || movingBuildingTypeRef.current !== null) {
        return;
      }

      const detail = (event as CustomEvent<BuildingPlacementCommitDetail>).detail;
      const committedBuildingType = toBuildingType(detail?.buildingId);
      if (committedBuildingType !== currentPending.buildingId || detail?.mode !== 'move') {
        return;
      }

      const x =
        typeof detail.position?.x === 'number' && Number.isFinite(detail.position.x)
          ? Math.floor(detail.position.x)
          : null;
      const y =
        typeof detail.position?.y === 'number' && Number.isFinite(detail.position.y)
          ? Math.floor(detail.position.y)
          : null;
      if (x === null || y === null) {
        pendingBuildingMoveRef.current = null;
        setPendingBuildingMove(null);
        notifyOperationRef.current('移動先の座標が不正でござった。', 'error');
        return;
      }

      pendingBuildingMoveRef.current = null;
      setPendingBuildingMove(null);
      movingBuildingTypeRef.current = committedBuildingType;
      setMovingBuildingType(committedBuildingType);
      void (async () => {
        try {
          const response = await fetch('/api/move-building', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
              buildingId: committedBuildingType,
              position: { x, y },
            }),
          });
          const payload = (await response
            .json()
            .catch(() => null)) as MoveBuildingApiResponse | null;

          if (!response.ok || payload?.success !== true || !isGameStatePayload(payload.gameState)) {
            notifyOperationRef.current(resolveMoveBuildingFailureMessage(payload), 'error');
            return;
          }

          updateGameStateRef.current(payload.gameState);
          notifyOperationRef.current(`${BUILDING_NAME_BY_TYPE[committedBuildingType]}を移動いたした。`, 'success');
        } catch {
          notifyOperationRef.current('建物移動に失敗いたした。通信が乱れた。', 'error');
        } finally {
          movingBuildingTypeRef.current = null;
          setMovingBuildingType(null);
        }
      })();
    };

    const handleCancel = (event: Event): void => {
      const currentPending = pendingBuildingMoveRef.current;
      if (!currentPending) {
        return;
      }

      const detail = (event as CustomEvent<BuildingPlacementCancelDetail>).detail;
      const canceledBuildingType = toBuildingType(detail?.buildingId);
      if (canceledBuildingType !== null && canceledBuildingType !== currentPending.buildingId) {
        return;
      }

      pendingBuildingMoveRef.current = null;
      setPendingBuildingMove(null);
      const message = detail?.message?.trim();
      notifyOperationRef.current(
        message && message.length > 0
          ? message
          : `${BUILDING_NAME_BY_TYPE[currentPending.buildingId]}の移動を取り止めた。`
      );
    };

    window.addEventListener(BUILDING_PLACEMENT_START_EVENT, handleStart as EventListener);
    window.addEventListener(BUILDING_PLACEMENT_COMMIT_EVENT, handleCommit as EventListener);
    window.addEventListener(BUILDING_PLACEMENT_CANCEL_EVENT, handleCancel as EventListener);

    return () => {
      window.removeEventListener(BUILDING_PLACEMENT_START_EVENT, handleStart as EventListener);
      window.removeEventListener(BUILDING_PLACEMENT_COMMIT_EVENT, handleCommit as EventListener);
      window.removeEventListener(BUILDING_PLACEMENT_CANCEL_EVENT, handleCancel as EventListener);
    };
  }, []);

  return (
    <div className="space-y-3 text-sm text-slate-100">
      {buildings.map((building) => {
        const buildingType = building.type;
        const config = BUILDING_CONFIGS[buildingType];
        const displayName = BUILDING_NAME_BY_TYPE[buildingType];
        const displayEmoji = config.emoji || FALLBACK_EMOJI_BY_TYPE[buildingType];
        const rewardRate = calculateTaskRewardRate(buildingType, building.level);
        const upgradeCost = resolveBuildingUpgradeCost(buildingType, building.level);
        const isMaxLevel = building.level >= config.maxLevel;
        const missingMaterialRequirements =
          upgradeCost !== null
            ? upgradeCost.materials
                .map((material) => toUpgradeMaterialRequirementGap(material, amountByItemId))
                .filter(
                  (material): material is UpgradeMaterialRequirementGap => material !== null
                )
            : [];
        const missingGold = upgradeCost !== null ? Math.max(0, upgradeCost.gold - currentGold) : 0;
        const hasGold = missingGold <= 0;
        const isBusy = upgradingBuildingType === buildingType;
        const upgradeAvailability = resolveUpgradeAvailability({
          isBusy,
          isMaxLevel,
          hasGold,
          missingMaterialCount: missingMaterialRequirements.length,
          upgradeCost,
        });
        const upgradeStateClassName = resolveUpgradeStateClassName(upgradeAvailability.vocabulary);
        const upgradeDetailMessages = buildUpgradeDetailMessages({
          vocabulary: upgradeAvailability.vocabulary,
          blockReason: upgradeAvailability.blockReason,
          upgradeCost,
          currentGold,
          missingMaterials: missingMaterialRequirements,
        });
        const upgradeDisabled =
          isBusy ||
          upgradingBuildingType !== null ||
          !upgradeAvailability.canUpgrade ||
          missingMaterialRequirements.length > 0;
        const taskCategory = BUILDING_TASK_CATEGORY_MAP[buildingType];
        const taskCategoryLabel = taskCategory ? TASK_CATEGORY_LABELS[taskCategory] : null;
        const dropMaterialNames = dropMaterialNamesByBuildingType[buildingType] ?? [];
        const upgradeCostText = isMaxLevel
          ? '最大'
          : upgradeCost
            ? formatUpgradeCostText(upgradeCost)
            : '情報なし';
        const buttonLabel = upgradeAvailability.buttonLabel;
        const isSelectingMoveTarget = pendingBuildingMove?.buildingId === buildingType;
        const isMoving = movingBuildingType === buildingType;
        const moveDisabled =
          pendingBuildingMove !== null || movingBuildingType !== null || upgradingBuildingType !== null;
        const moveButtonLabel = isMoving ? '移動中...' : isSelectingMoveTarget ? '選択中...' : '移動';

        return (
          <article
            key={`building-card-${buildingType}`}
            className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 p-3"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h4
                className="text-sm font-semibold text-slate-50"
                style={{ fontFamily: '"Noto Serif JP", serif' }}
              >
                {displayEmoji} {displayName} Lv.{building.level}
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={upgradeDisabled}
                  onClick={() => void handleUpgrade(buildingType)}
                  className={[
                    ACTION_BUTTON_BASE_CLASS,
                    upgradeDisabled ? ACTION_BUTTON_DISABLED_CLASS : ACTION_BUTTON_PRIMARY_CLASS,
                  ].join(' ')}
                >
                  {buttonLabel}
                </button>
                <button
                  type="button"
                  disabled={moveDisabled}
                  onClick={() => handleMoveBuilding(buildingType)}
                  className={[
                    ACTION_BUTTON_BASE_CLASS,
                    moveDisabled ? ACTION_BUTTON_DISABLED_CLASS : ACTION_BUTTON_OUTLINE_CLASS,
                  ].join(' ')}
                >
                  {moveButtonLabel}
                </button>
              </div>
            </div>

            {taskCategoryLabel ? (
              <p className="text-xs text-slate-300">任務分類: {taskCategoryLabel}</p>
            ) : null}
            <p className="text-xs text-slate-300">
              報酬レート: 小判 {toSafeInteger(rewardRate.goldPerMinute)}両/分 修練値{' '}
              {toSafeInteger(rewardRate.xpPerMinute)}/分
            </p>
            <p className="text-xs text-slate-300">
              素材ドロップ: {dropMaterialNames.length > 0 ? dropMaterialNames.join(' / ') : 'なし'}
            </p>
            <p className="text-xs text-slate-300">改築コスト: {upgradeCostText}</p>
            <p className={`mt-1 text-[11px] font-semibold ${upgradeStateClassName}`}>
              状態: {upgradeAvailability.vocabulary}
            </p>
            {upgradeDetailMessages.length > 0 ? (
              <p className={`mt-1 text-[11px] ${upgradeStateClassName}`}>
                {upgradeDetailMessages.join(' / ')}
              </p>
            ) : null}
          </article>
        );
      })}

      <section className="space-y-2 border-t border-[color:var(--kincha)]/25 pt-3">
        <h4
          className="text-xs font-semibold tracking-[0.08em] text-[color:var(--kincha)]"
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          装飾
        </h4>

        {decorationEntries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-500/35 px-3 py-2 text-xs text-slate-400">
            未設置の装飾なし
          </p>
        ) : (
          decorationEntries.map((entry) => (
            <article
              key={`decoration-card-${entry.type}`}
              className="rounded-lg border border-[color:var(--kincha)]/25 bg-black/20 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                  <span>{entry.meta.emoji}</span>
                  <span>{entry.meta.label}</span>
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: entry.meta.color }}
                  />
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-300">未設置 ×{entry.unplaced}</p>
                  <button
                    type="button"
                    onClick={() => handlePlaceDecoration(entry.type)}
                    className={`${ACTION_BUTTON_BASE_CLASS} ${ACTION_BUTTON_OUTLINE_CLASS} px-2 py-1 text-[11px]`}
                  >
                    設置
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
};

export default BuildingListView;
