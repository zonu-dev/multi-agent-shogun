import type { BuildingLevel, BuildingType, GameState } from '@/types';
import { useGameStore } from '@/store/gameStore';

export interface PopupUpgradeMaterialCost {
  id: string;
  name: string;
  quantity: number;
}

export interface PopupUpgradeCostInfo {
  available: boolean;
  maxLevel: boolean;
  canAfford: boolean;
  toLevel: BuildingLevel | null;
  gold: number;
  materials: PopupUpgradeMaterialCost[];
  missingGold: number;
  missingMaterials: PopupUpgradeMaterialCost[];
  errorMessage: string | null;
}

interface UpgradeCostApiResponse {
  success?: boolean;
  error?: string;
  cost?: {
    toLevel?: unknown;
    gold?: unknown;
    materials?: unknown;
  };
  affordability?: {
    missingGold?: unknown;
    missingMaterials?: unknown;
  };
}

interface UpgradeBuildingApiResponse {
  success?: boolean;
  error?: string;
  building?: {
    level?: unknown;
  };
  gameState?: unknown;
}

interface SceneApiServiceOptions {
  resolveUpgradeMaxLevel: (type: BuildingType) => BuildingLevel;
  isUpgradeCostBuildingType: (type: BuildingType) => boolean;
  normalizeBuildingLevel: (value: unknown) => BuildingLevel;
  buildingLabels: Readonly<Record<BuildingType, string>>;
  applyBuildingUpgradeLevel: (type: BuildingType, level: BuildingLevel) => void;
  requestTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toBuildingLevel = (value: unknown): BuildingLevel | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  if (normalized < 1 || normalized > 5) {
    return null;
  }

  return normalized as BuildingLevel;
};

const isGameStatePayload = (value: unknown): value is GameState => {
  return (
    isRecord(value) &&
    Array.isArray(value.ashigaru) &&
    Array.isArray(value.buildings) &&
    isRecord(value.town) &&
    Array.isArray(value.inventory) &&
    Array.isArray(value.decorations) &&
    Array.isArray(value.missions) &&
    Array.isArray(value.activityLog)
  );
};

export class SceneApiService {
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: SceneApiServiceOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private toPopupMaterialEntries(rawMaterials: unknown): PopupUpgradeMaterialCost[] {
    if (!Array.isArray(rawMaterials)) {
      return [];
    }

    return rawMaterials
      .map((rawMaterial) => {
        if (!isRecord(rawMaterial)) {
          return null;
        }

        const id = typeof rawMaterial.id === 'string' ? rawMaterial.id.trim() : '';
        const name = typeof rawMaterial.name === 'string' ? rawMaterial.name.trim() : '';
        const quantity =
          typeof rawMaterial.quantity === 'number' && Number.isFinite(rawMaterial.quantity)
            ? Math.max(0, Math.floor(rawMaterial.quantity))
            : 0;

        if (id.length === 0 || name.length === 0 || quantity <= 0) {
          return null;
        }

        return { id, name, quantity };
      })
      .filter((entry): entry is PopupUpgradeMaterialCost => entry !== null);
  }

  public async resolveUpgradeCostInfo(
    type: BuildingType,
    level: BuildingLevel
  ): Promise<PopupUpgradeCostInfo> {
    const maxLevel = this.options.resolveUpgradeMaxLevel(type);

    if (!this.options.isUpgradeCostBuildingType(type)) {
      return {
        available: false,
        maxLevel: false,
        canAfford: false,
        toLevel: null,
        gold: 0,
        materials: [],
        missingGold: 0,
        missingMaterials: [],
        errorMessage: null,
      };
    }

    if (level >= maxLevel) {
      return {
        available: true,
        maxLevel: true,
        canAfford: false,
        toLevel: null,
        gold: 0,
        materials: [],
        missingGold: 0,
        missingMaterials: [],
        errorMessage: null,
      };
    }

    try {
      const query = new URLSearchParams({
        buildingId: type,
        currentLevel: String(level),
      });
      const endpoint = `/api/upgrade-cost?${query.toString()}`;
      const controller = typeof AbortController === 'undefined' ? null : new AbortController();
      const timeoutId = controller
        ? globalThis.setTimeout(() => {
            controller.abort();
          }, this.requestTimeoutMs)
        : null;

      let response: Response;
      try {
        response = await fetch(endpoint, controller ? { signal: controller.signal } : undefined);
      } finally {
        if (timeoutId !== null) {
          globalThis.clearTimeout(timeoutId);
        }
      }

      const payload = (await response.json().catch(() => null)) as UpgradeCostApiResponse | null;

      if (!response.ok || payload?.success !== true || !isRecord(payload.cost)) {
        return {
          available: true,
          maxLevel: false,
          canAfford: false,
          toLevel: null,
          gold: 0,
          materials: [],
          missingGold: 0,
          missingMaterials: [],
          errorMessage: payload?.error ?? '改築費用の取得に失敗いたした。',
        };
      }

      const toLevel = toBuildingLevel(payload.cost.toLevel);
      const gold =
        typeof payload.cost.gold === 'number' && Number.isFinite(payload.cost.gold)
          ? Math.max(0, Math.floor(payload.cost.gold))
          : 0;
      const materials = this.toPopupMaterialEntries(payload.cost.materials);
      const affordability = isRecord(payload.affordability) ? payload.affordability : {};
      const missingGold =
        typeof affordability.missingGold === 'number' && Number.isFinite(affordability.missingGold)
          ? Math.max(0, Math.floor(affordability.missingGold))
          : 0;
      const missingMaterials = this.toPopupMaterialEntries(affordability.missingMaterials);

      return {
        available: true,
        maxLevel: false,
        canAfford: missingGold <= 0 && missingMaterials.length === 0,
        toLevel,
        gold,
        materials,
        missingGold,
        missingMaterials,
        errorMessage: null,
      };
    } catch {
      return {
        available: true,
        maxLevel: false,
        canAfford: false,
        toLevel: null,
        gold: 0,
        materials: [],
        missingGold: 0,
        missingMaterials: [],
        errorMessage: '改築費用の取得に失敗いたした。',
      };
    }
  }

  public async requestBuildingUpgrade(
    type: BuildingType,
    currentLevel: BuildingLevel
  ): Promise<{ success: boolean; nextLevel: BuildingLevel | null; message: string }> {
    const maxLevel = this.options.resolveUpgradeMaxLevel(type);

    if (!this.options.isUpgradeCostBuildingType(type)) {
      return {
        success: false,
        nextLevel: null,
        message: 'この建物は改築対象外でござる。',
      };
    }

    if (currentLevel >= maxLevel) {
      return {
        success: false,
        nextLevel: null,
        message: '最大レベル到達でござる。',
      };
    }

    const requestedLevel = this.options.normalizeBuildingLevel((currentLevel + 1) as BuildingLevel);

    try {
      const response = await fetch('/api/upgrade-building', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildingId: type,
          newLevel: requestedLevel,
        }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as UpgradeBuildingApiResponse | null;

      if (!response.ok || payload?.success !== true) {
        return {
          success: false,
          nextLevel: null,
          message: payload?.error ?? '改築に失敗いたした。',
        };
      }

      const nextLevel = toBuildingLevel(payload?.building?.level) ?? requestedLevel;
      this.options.applyBuildingUpgradeLevel(type, nextLevel);

      if (isGameStatePayload(payload.gameState)) {
        useGameStore.getState().updateGameState(payload.gameState);
      }

      return {
        success: true,
        nextLevel,
        message: `${this.options.buildingLabels[type]}をLv.${nextLevel}に改築いたした。`,
      };
    } catch {
      return {
        success: false,
        nextLevel: null,
        message: '通信に失敗いたした。時をおいて再試行されよ。',
      };
    }
  }
}
