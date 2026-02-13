import type { OperationNoticeTone } from '@/lib/ui/operationNotice';
import { ITEM_MASTER } from '@/data/item-master';
import type { GameState } from '@/types';

export const DECORATION_CLICK_EVENT = 'shogun:decoration-click';
export const DECORATION_PLACEMENT_START_EVENT = 'shogun:decoration-placement:start';
export const DECORATION_PLACEMENT_COMMIT_EVENT = 'shogun:decoration-placement:commit';
export const DECORATION_PLACEMENT_CANCEL_EVENT = 'shogun:decoration-placement:cancel';
export const DECORATION_INVENTORY_PLACE_REQUEST_EVENT = 'shogun:decoration-inventory-place:request';

export type PendingPlacementMode = 'inventory' | 'move';
export type DecorationProcessingAction = 'collect' | 'move' | 'upgrade';
export type DecorationOperationNotifier = (message: string, tone?: OperationNoticeTone) => void;

export interface DecorationClickDetail {
  id?: string;
  type?: string;
  level?: number;
  passiveEffect?: {
    type?: string;
    bonusPerLevel?: number;
  };
  position?: {
    x?: number;
    y?: number;
  };
  screen?: {
    x?: number;
    y?: number;
  };
}

export interface DecorationPlacementCommitDetail {
  decorationType?: string;
  position?: {
    x?: number;
    y?: number;
  };
}

export interface DecorationPlacementCancelDetail {
  message?: string;
}

export interface DecorationInventoryPlaceRequestDetail {
  decorationType?: string;
}

export interface DecorationActionApiResponse {
  success?: boolean;
  error?: string;
  gameState?: unknown;
  decoration?: unknown;
}

export type DecorationPassiveType = 'gold_bonus' | 'xp_bonus' | 'drop_rate_bonus';

export interface SelectedDecoration {
  id: string;
  type: string;
  level: number;
  passiveEffect?: {
    type: DecorationPassiveType;
    bonusPerLevel: number;
  };
  position: {
    x: number;
    y: number;
  };
  screen: {
    x: number;
    y: number;
  } | null;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PopupPosition {
  left: number;
  top: number;
}

export interface PendingPlacement {
  mode: PendingPlacementMode;
  decorationType: string;
  decorationId: string | null;
}

const DECORATION_META: Record<string, { emoji: string; label: string }> = {
  maneki_neko: { emoji: '🐈', label: '招き猫' },
  komainu: { emoji: '🦁', label: '狛犬' },
  ishidoro: { emoji: '🏮', label: '石灯籠' },
  sakura_tree: { emoji: '🌸', label: '桜の木' },
  stone_lantern: { emoji: '🏮', label: '石灯籠' },
  market_stall: { emoji: '🏪', label: '市場屋台' },
};

const DECORATION_UPGRADE_COSTS_BY_TYPE = new Map<string, number[]>(
  ITEM_MASTER.filter((item) => item.itemType === 'decoration' && Array.isArray(item.upgradeCosts))
    .map<[string, number[]]>((item) => {
      const normalizedCosts = (item.upgradeCosts ?? [])
        .map((cost) => (Number.isFinite(cost) ? Math.max(0, Math.floor(cost)) : null))
        .filter((cost): cost is number => cost !== null);

      return [item.id, normalizedCosts];
    })
    .filter((entry) => entry[1].length > 0)
);

export const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
export const POPUP_VIEWPORT_MARGIN = 12;
export const POPUP_TARGET_OFFSET_X = 52;
export const POPUP_TARGET_OFFSET_Y = 28;
export const POPUP_FALLBACK_WIDTH = 328;
export const POPUP_FALLBACK_HEIGHT = 240;
export const POINTER_RECENCY_MS = 700;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isGameStatePayload = (value: unknown): value is GameState =>
  isRecord(value) &&
  Array.isArray(value.ashigaru) &&
  Array.isArray(value.buildings) &&
  isRecord(value.town) &&
  isRecord(value.economy) &&
  Array.isArray(value.inventory) &&
  Array.isArray(value.decorations) &&
  Array.isArray(value.missions) &&
  Array.isArray(value.activityLog);

export const toDecorationType = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const toDecorationLevel = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(5, Math.floor(value)));
};

export const toPassiveEffect = (
  value: unknown
): { type: DecorationPassiveType; bonusPerLevel: number } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const type =
    value.type === 'gold_bonus' || value.type === 'xp_bonus' || value.type === 'drop_rate_bonus'
      ? value.type
      : null;
  const bonusPerLevel =
    typeof value.bonusPerLevel === 'number' && Number.isFinite(value.bonusPerLevel)
      ? value.bonusPerLevel
      : null;
  if (type === null || bonusPerLevel === null || bonusPerLevel <= 0) {
    return undefined;
  }

  return {
    type,
    bonusPerLevel,
  };
};

export const resolveDecorationMeta = (type: string): { emoji: string; label: string } =>
  DECORATION_META[type] ?? {
    emoji: '🧩',
    label: type,
  };

export const resolveDecorationUpgradeCost = (decorationType: string, level: number): number | null => {
  const costs = DECORATION_UPGRADE_COSTS_BY_TYPE.get(decorationType);
  if (!costs || level >= 5) {
    return null;
  }

  const cost = costs[level - 1];
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : null;
};

export const formatPassiveEffectText = (
  passiveEffect: SelectedDecoration['passiveEffect'] | undefined,
  level: number
): string => {
  if (!passiveEffect) {
    return '効果: なし';
  }

  const bonusPercent = Math.round(passiveEffect.bonusPerLevel * level * 100);
  if (passiveEffect.type === 'gold_bonus') {
    return `効果: 小判獲得 +${bonusPercent}%`;
  }
  if (passiveEffect.type === 'xp_bonus') {
    return `効果: 修練値獲得 +${bonusPercent}%`;
  }

  return `効果: 素材ドロップ率 +${bonusPercent}%`;
};

export const toScreenPoint = (value: unknown): ScreenPoint | null => {
  if (!isRecord(value)) {
    return null;
  }

  const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : null;
  const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : null;
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
};

export const normalizeSelectedDecoration = (payload: unknown): SelectedDecoration | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const detail = payload as DecorationClickDetail;
  const id = toDecorationType(detail.id);
  const type = toDecorationType(detail.type);
  const x =
    typeof detail.position?.x === 'number' && Number.isFinite(detail.position.x)
      ? Math.floor(detail.position.x)
      : null;
  const y =
    typeof detail.position?.y === 'number' && Number.isFinite(detail.position.y)
      ? Math.floor(detail.position.y)
      : null;

  if (!id || !type || x === null || y === null) {
    return null;
  }

  return {
    id,
    type,
    level: toDecorationLevel(detail.level),
    passiveEffect: toPassiveEffect(detail.passiveEffect),
    position: { x, y },
    screen: toScreenPoint(detail.screen),
  };
};

export const extractError = (payload: DecorationActionApiResponse | null, fallback: string): string => {
  const reason = payload?.error?.trim();
  return reason && reason.length > 0 ? reason : fallback;
};
