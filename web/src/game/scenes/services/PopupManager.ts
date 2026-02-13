import Phaser from 'phaser';
import { TASK_TO_BUILDING_MAP, type BuildingLevel, type BuildingType } from '@/types';
import { calculateTaskRewardRate } from '@/lib/gamification/economy';
import type { BuildingClickPayload } from '../../objects/buildings/Building';
import type { PopupUpgradeCostInfo } from './SceneApiService';
import type { BuildingPopupStatus } from './StateAdapter';

interface OpenPopupMessage {
  text: string;
  color: string;
}

export interface PopupThemeTokens {
  panelFill: number;
  panelStroke: number;
  panelFillAlpha: number;
  titleText: string;
  statusIdleText: string;
  statusWorkingText: string;
  statusBlockedText: string;
  rewardText: string;
  dropText: string;
  upgradeCostText: string;
  primaryText: string;
  mutedText: string;
  dangerText: string;
  successText: string;
  closeButtonText: string;
  closeButtonBackground: string;
  upgradeButtonDisabledFill: number;
  upgradeButtonEnabledFill: number;
  upgradeButtonDisabledStroke: number;
  upgradeButtonEnabledStroke: number;
  upgradeButtonDisabledText: string;
  upgradeButtonEnabledText: string;
}

interface PopupManagerDependencies {
  scene: Phaser.Scene;
  resolveBuildingLabel: (type: BuildingType) => string;
  getBuildingAnchor: (type: BuildingType) => Phaser.Math.Vector2;
  normalizeBuildingLevel: (value: unknown) => BuildingLevel;
  resolveUpgradeCostInfo: (
    type: BuildingType,
    level: BuildingLevel
  ) => Promise<PopupUpgradeCostInfo>;
  requestBuildingUpgrade: (
    type: BuildingType,
    currentLevel: BuildingLevel
  ) => Promise<{ success: boolean; nextLevel: BuildingLevel | null; message: string }>;
  resolveBuildingPopupStatus: (type: BuildingType) => BuildingPopupStatus;
  getAssignedWorkersWithElapsedForBuilding: (type: BuildingType) => string[];
  theme?: Partial<PopupThemeTokens>;
  resolveTheme?: () => Partial<PopupThemeTokens>;
}

const BUILDING_POPUP_DEPTH = 10_000;
const POPUP_HORIZONTAL_PADDING = 14;
const POPUP_MIN_WIDTH = 248;
const POPUP_MAX_WIDTH = 420;
const POPUP_WIDTH_RATIO = 0.42;
const POPUP_BODY_FONT = '11px "Noto Sans JP", sans-serif';
const BUILDING_POPUP_HORIZONTAL_OFFSET_RATIO = 0.18;
const BUILDING_POPUP_VERTICAL_GAP = 34;
const BUILDING_PLACEMENT_START_EVENT = 'shogun:building-placement:start';

const DEFAULT_POPUP_THEME: PopupThemeTokens = {
  panelFill: 0x1f2937,
  panelStroke: 0xcaa05a,
  panelFillAlpha: 0.94,
  titleText: '#f5deb3',
  statusIdleText: '#cbd5e1',
  statusWorkingText: '#93c5fd',
  statusBlockedText: '#fca5a5',
  rewardText: '#bfdbfe',
  dropText: '#86efac',
  upgradeCostText: '#fde68a',
  primaryText: '#e2e8f0',
  mutedText: '#94a3b8',
  dangerText: '#fca5a5',
  successText: '#86efac',
  closeButtonText: '#fca5a5',
  closeButtonBackground: '#3f1d1d',
  upgradeButtonDisabledFill: 0x475569,
  upgradeButtonEnabledFill: 0x166534,
  upgradeButtonDisabledStroke: 0x94a3b8,
  upgradeButtonEnabledStroke: 0x86efac,
  upgradeButtonDisabledText: '#cbd5e1',
  upgradeButtonEnabledText: '#dcfce7',
};

const REWARD_RATE_BUILDING_TYPES: readonly BuildingType[] = Array.from(
  new Set(Object.values(TASK_TO_BUILDING_MAP))
) as BuildingType[];

const MATERIAL_NAME_BY_ID: Record<string, string> = {
  cedar_lumber: '杉材',
  stone_block: '石材',
  tamahagane_ingot: '玉鋼片',
  hemp_cloth: '麻布',
  sumi_ink: '松煙墨',
  medicinal_herb: '薬草束',
  adamantite_fragment: '黒鉄片',
};

const MATERIAL_ICON_BY_ID: Record<string, string> = {
  cedar_lumber: '🪵',
  stone_block: '🪨',
  tamahagane_ingot: '⚙️',
  hemp_cloth: '🧵',
  sumi_ink: '🖌️',
  medicinal_herb: '🌿',
  adamantite_fragment: '⛏️',
};

const MATERIAL_DROP_ITEMS_BY_BUILDING: Partial<Record<BuildingType, readonly string[]>> = {
  dojo: ['tamahagane_ingot', 'hemp_cloth'],
  smithy: ['adamantite_fragment', 'tamahagane_ingot'],
  training: ['cedar_lumber', 'stone_block'],
  study: ['sumi_ink', 'cedar_lumber'],
  healer: ['medicinal_herb', 'hemp_cloth'],
  watchtower: ['stone_block', 'tamahagane_ingot'],
  scriptorium: ['sumi_ink', 'hemp_cloth'],
};

const KNOWN_BUILDING_TYPES: readonly BuildingType[] = [
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

const LEGACY_POPUP_BUILDING_TYPE_MAP: Readonly<Record<string, BuildingType>> = {
  farm: 'training',
  mine: 'smithy',
  market: 'scriptorium',
  farmland: 'training',
  mine_site: 'smithy',
  marketplace: 'scriptorium',
  農地: 'training',
  鉱山: 'smithy',
  市場: 'scriptorium',
};

let textMeasureContext: CanvasRenderingContext2D | null | undefined;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isKnownBuildingType = (value: string): value is BuildingType =>
  KNOWN_BUILDING_TYPES.includes(value as BuildingType);

const normalizePopupBuildingType = (value: unknown): BuildingType | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (isKnownBuildingType(normalized)) {
    return normalized;
  }

  return LEGACY_POPUP_BUILDING_TYPE_MAP[normalized] ?? null;
};

const resolveTextMeasureContext = (): CanvasRenderingContext2D | null => {
  if (textMeasureContext !== undefined) {
    return textMeasureContext;
  }
  if (typeof document === 'undefined') {
    textMeasureContext = null;
    return textMeasureContext;
  }

  textMeasureContext = document.createElement('canvas').getContext('2d');
  return textMeasureContext;
};

const measureTextWidth = (text: string, font: string): number => {
  const context = resolveTextMeasureContext();
  if (!context) {
    return text.length * 8;
  }

  context.font = font;
  return context.measureText(text).width;
};

const wrapPopupTextLines = (text: string, maxWidthPx: number, font: string): string[] => {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return [];
  }
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    return [normalized];
  }

  const lines: string[] = [];
  const chunks = normalized
    .split('\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  for (const chunk of chunks) {
    let currentLine = '';
    for (const character of Array.from(chunk)) {
      const nextLine = `${currentLine}${character}`;
      if (currentLine.length > 0 && measureTextWidth(nextLine, font) > maxWidthPx) {
        lines.push(currentLine);
        currentLine = character;
        continue;
      }

      currentLine = nextLine;
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }

  return lines;
};

const createMeaningfulRewardRateLines = (
  label: string,
  goldPerMinute: number,
  xpPerMinute: number
): string[] => {
  const goldRateText = `小判: ${goldPerMinute}両/分`;
  const xpRateText = `修練値: ${xpPerMinute}/分`;
  return [`${label}: ${goldRateText}、${xpRateText}`];
};

const createRewardRateLines = (type: BuildingType, level: BuildingLevel): string[] => {
  if (type === 'inn') {
    return [];
  }

  if (!REWARD_RATE_BUILDING_TYPES.includes(type)) {
    return [];
  }

  const currentRate = calculateTaskRewardRate(type, level);
  const lines = createMeaningfulRewardRateLines(
    '現在の報酬レート',
    currentRate.goldPerMinute,
    currentRate.xpPerMinute
  );

  if (level < 5) {
    const nextLevel = (level + 1) as BuildingLevel;
    const nextRate = calculateTaskRewardRate(type, nextLevel);
    lines.push(
      ...createMeaningfulRewardRateLines('次Lv', nextRate.goldPerMinute, nextRate.xpPerMinute)
    );
  }

  return lines;
};

const createMaterialDropLine = (type: BuildingType): string | null => {
  const materialIds = MATERIAL_DROP_ITEMS_BY_BUILDING[type];
  if (!materialIds || materialIds.length === 0) {
    return null;
  }

  const names = materialIds.map((itemId) => MATERIAL_NAME_BY_ID[itemId] ?? itemId);
  return `ドロップ: ${names.join(', ')}`;
};

const resolveUpgradeCostDisplayLines = (info: PopupUpgradeCostInfo): string[] => {
  if (!info.available) {
    return ['改築費用: 対象外'];
  }

  if (info.maxLevel) {
    return ['改築費用: 最大'];
  }

  if (info.errorMessage !== null) {
    return ['改築費用: 情報取得失敗'];
  }

  const materialCostText = info.materials
    .map((material) => {
      const icon = MATERIAL_ICON_BY_ID[material.id] ?? '📦';
      return `${icon}${material.name}×${material.quantity}`;
    })
    .join(' + ');

  const text =
    materialCostText.length > 0
      ? `改築費用: 💰${info.gold}両 + ${materialCostText}`
      : `改築費用: 💰${info.gold}両`;

  return [text];
};

const resolveUpgradeBlockedReason = (info: PopupUpgradeCostInfo): string | null => {
  if (!info.available) {
    return 'この建物は改築対象外でござる。';
  }

  if (info.maxLevel) {
    return '最大レベル到達でござる。';
  }

  if (info.errorMessage !== null) {
    return info.errorMessage;
  }

  if (info.missingGold > 0 || info.missingMaterials.length > 0) {
    const missingText = info.missingMaterials
      .map((material) => `${material.name}×${Math.max(0, material.quantity)}`)
      .join(' / ');

    if (info.missingGold > 0 && missingText.length > 0) {
      return `不足: 💰${info.missingGold}両 / ${missingText}`;
    }

    if (info.missingGold > 0) {
      return `不足: 💰${info.missingGold}両`;
    }

    if (missingText.length > 0) {
      return `不足: ${missingText}`;
    }
  }

  return null;
};

interface NormalizedPopupPayloadResult {
  payload: BuildingClickPayload;
  missingDataMessage: string | null;
}

const normalizePopupPayload = (
  payload: BuildingClickPayload,
  normalizeBuildingLevel: (value: unknown) => BuildingLevel
): NormalizedPopupPayloadResult => {
  const rawType = (payload as { type?: unknown }).type;
  const rawLevel = (payload as { level?: unknown }).level;
  const rawPosition = (payload as { position?: unknown }).position;
  const normalizedType = normalizePopupBuildingType(rawType);
  const safeType = normalizedType ?? 'inn';

  const rawX =
    typeof rawPosition === 'object' && rawPosition !== null
      ? (rawPosition as { x?: unknown }).x
      : null;
  const rawY =
    typeof rawPosition === 'object' && rawPosition !== null
      ? (rawPosition as { y?: unknown }).y
      : null;
  const hasPosition = isFiniteNumber(rawX) && isFiniteNumber(rawY);
  const safePosition = hasPosition
    ? { x: Math.floor(rawX), y: Math.floor(rawY) }
    : { x: 0, y: 0 };
  const hasLevel = isFiniteNumber(rawLevel);

  let missingDataMessage: string | null = null;
  if (normalizedType === null) {
    missingDataMessage = '建物データ不足: 種別を特定できぬ。';
  } else if (!hasPosition) {
    missingDataMessage = '建物データ不足: 位置情報が不足しておる。';
  } else if (!hasLevel) {
    missingDataMessage = '建物データ不足: レベル情報が不足しておる。';
  }

  return {
    payload: {
      type: safeType,
      level: normalizeBuildingLevel(rawLevel),
      position: safePosition,
    },
    missingDataMessage,
  };
};

interface PopupViewModel {
  payload: BuildingClickPayload;
  status: BuildingPopupStatus;
  assignees: string[];
  normalizedLevel: BuildingLevel;
  theme: PopupThemeTokens;
  panelWidth: number;
  panelHeight: number;
  popupX: number;
  popupY: number;
  textContentWidth: number;
  rewardRateDisplayLines: string[];
  materialDropDisplayLines: string[];
  showInlineAssignee: boolean;
  upgradeSectionTopY: number;
}

interface UpgradeSectionState {
  loading: boolean;
  info: PopupUpgradeCostInfo;
  feedbackMessage: OpenPopupMessage | null;
  isUpgrading: boolean;
  isPreparingMove: boolean;
}

interface PopupUiElements {
  container: Phaser.GameObjects.Container;
  upgradeCostText: Phaser.GameObjects.Text;
  upgradeLabel: Phaser.GameObjects.Text;
  upgradeButtonBackground: Phaser.GameObjects.Rectangle;
  upgradeButtonText: Phaser.GameObjects.Text;
  moveButtonBackground: Phaser.GameObjects.Rectangle;
  moveButtonText: Phaser.GameObjects.Text;
  upgradeFeedback: Phaser.GameObjects.Text;
}

interface UpgradeInteractionState {
  canUpgradeAction: boolean;
  defaultUpgradeButtonLabel: string;
  blockedReason: string | null;
  toLevelLabel: string;
}

const UPGRADE_SECTION_HEIGHT = 88;
const UPGRADE_COST_RESERVED_LINES = 3;
const UPGRADE_COST_LOADING_TEXT = '改築費用: 計算中…';

export class PopupManager {
  private buildingPopup: Phaser.GameObjects.Container | null = null;
  private suppressPopupAutoClose = false;
  private popupRenderVersion = 0;

  constructor(private readonly dependencies: PopupManagerDependencies) {}

  private createUnavailableUpgradeCostInfo(): PopupUpgradeCostInfo {
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

  private createUpgradeCostErrorInfo(): PopupUpgradeCostInfo {
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

  private resolveThemeTokens(): PopupThemeTokens {
    const themeOverrides = this.dependencies.resolveTheme?.() ?? this.dependencies.theme ?? {};
    return {
      ...DEFAULT_POPUP_THEME,
      ...themeOverrides,
    };
  }

  private createInitialUpgradeSectionState(
    payload: BuildingClickPayload,
    initialMessage?: OpenPopupMessage
  ): UpgradeSectionState {
    const upgradeCostAvailable = payload.type !== 'inn';
    return {
      loading: upgradeCostAvailable,
      info: this.createUnavailableUpgradeCostInfo(),
      feedbackMessage: initialMessage ?? null,
      isUpgrading: false,
      isPreparingMove: false,
    };
  }

  private createPopupViewModel(
    payload: BuildingClickPayload,
    status: BuildingPopupStatus,
    assignees: string[],
    normalizedLevel: BuildingLevel,
    theme: PopupThemeTokens,
    reserveUpgradeCostLines: boolean
  ): PopupViewModel {
    const scene = this.dependencies.scene;
    const camera = scene.cameras.main;
    const panelWidth = Phaser.Math.Clamp(
      Math.round(camera.width * POPUP_WIDTH_RATIO),
      POPUP_MIN_WIDTH,
      POPUP_MAX_WIDTH
    );
    const textContentWidth = Math.max(96, panelWidth - POPUP_HORIZONTAL_PADDING * 2);
    const rewardRateLines = createRewardRateLines(payload.type, normalizedLevel);
    const materialDropLine = createMaterialDropLine(payload.type);
    const rewardRateDisplayLines = rewardRateLines.flatMap((line) =>
      wrapPopupTextLines(line, textContentWidth, POPUP_BODY_FONT)
    );
    const materialDropDisplayLines = materialDropLine
      ? wrapPopupTextLines(materialDropLine, textContentWidth, POPUP_BODY_FONT)
      : [];
    const upgradeCostLineCount = reserveUpgradeCostLines
      ? UPGRADE_COST_RESERVED_LINES
      : Math.max(
          1,
          resolveUpgradeCostDisplayLines(this.createUnavailableUpgradeCostInfo()).flatMap((line) =>
            wrapPopupTextLines(line, textContentWidth, POPUP_BODY_FONT)
          ).length
        );
    const infoLineCount =
      rewardRateDisplayLines.length + materialDropDisplayLines.length + upgradeCostLineCount;
    const showInlineAssignee =
      (payload.type === 'castle' || payload.type === 'mansion') && assignees.length > 0;
    const workerLineCount = showInlineAssignee ? 0 : Math.max(1, assignees.length);
    const infoHeight = infoLineCount > 0 ? infoLineCount * 16 + 10 : 0;
    const panelHeight = 146 + workerLineCount * 16 + infoHeight + UPGRADE_SECTION_HEIGHT;
    const worldView = camera.worldView;
    const anchor = this.dependencies.getBuildingAnchor(payload.type);
    const desiredX = anchor.x + panelWidth * BUILDING_POPUP_HORIZONTAL_OFFSET_RATIO;
    const desiredY = anchor.y - panelHeight / 2 - BUILDING_POPUP_VERTICAL_GAP;
    const minX = worldView.left + panelWidth / 2 + 12;
    const maxX = worldView.right - panelWidth / 2 - 12;
    const minY = worldView.top + panelHeight / 2 + 12;
    const maxY = worldView.bottom - panelHeight / 2 - 12;
    const popupX = minX <= maxX ? Phaser.Math.Clamp(desiredX, minX, maxX) : worldView.centerX;
    const popupY = minY <= maxY ? Phaser.Math.Clamp(desiredY, minY, maxY) : worldView.centerY;
    let upgradeSectionTopY = -panelHeight / 2 + 62;
    if (rewardRateDisplayLines.length > 0) {
      upgradeSectionTopY += rewardRateDisplayLines.length * 16 + 4;
    }
    if (materialDropDisplayLines.length > 0) {
      upgradeSectionTopY += materialDropDisplayLines.length * 16 + 4;
    }

    return {
      payload,
      status,
      assignees,
      normalizedLevel,
      theme,
      panelWidth,
      panelHeight,
      popupX,
      popupY,
      textContentWidth,
      rewardRateDisplayLines,
      materialDropDisplayLines,
      showInlineAssignee,
      upgradeSectionTopY,
    };
  }

  private resolveUpgradeCostDisplayLinesForState(
    upgradeState: UpgradeSectionState,
    textContentWidth: number
  ): string[] {
    const baseLines = upgradeState.loading
      ? [UPGRADE_COST_LOADING_TEXT]
      : resolveUpgradeCostDisplayLines(upgradeState.info);
    const wrappedLines = baseLines.flatMap((line) =>
      wrapPopupTextLines(line, textContentWidth, POPUP_BODY_FONT)
    );
    if (wrappedLines.length <= UPGRADE_COST_RESERVED_LINES) {
      return wrappedLines;
    }

    const truncated = wrappedLines.slice(0, UPGRADE_COST_RESERVED_LINES);
    const lastLineIndex = truncated.length - 1;
    truncated[lastLineIndex] = `${truncated[lastLineIndex]}…`;
    return truncated;
  }

  private resolveUpgradeInteractionState(
    upgradeState: UpgradeSectionState
  ): UpgradeInteractionState {
    const info = upgradeState.info;
    const canUpgradeAction =
      !upgradeState.loading &&
      info.available &&
      !info.maxLevel &&
      info.canAfford &&
      info.errorMessage === null &&
      info.toLevel !== null;
    const defaultUpgradeButtonLabel = upgradeState.loading
      ? '計算中'
      : info.maxLevel
        ? '最大'
        : info.available
          ? '改築'
          : '対象外';
    const blockedReason = upgradeState.loading ? null : resolveUpgradeBlockedReason(info);
    const toLevelLabel = upgradeState.loading
      ? '...'
      : info.toLevel
        ? `Lv.${info.toLevel}`
        : info.maxLevel
          ? '最大'
          : '---';

    return {
      canUpgradeAction,
      defaultUpgradeButtonLabel,
      blockedReason,
      toLevelLabel,
    };
  }

  private refreshUpgradeSectionUi(
    viewModel: PopupViewModel,
    upgradeState: UpgradeSectionState,
    ui: PopupUiElements
  ): void {
    const { theme, panelWidth, textContentWidth } = viewModel;
    const leftX = -panelWidth / 2 + POPUP_HORIZONTAL_PADDING;
    const costDisplayLines = this.resolveUpgradeCostDisplayLinesForState(
      upgradeState,
      textContentWidth
    );
    const interactionState = this.resolveUpgradeInteractionState(upgradeState);
    const costLineCount = Math.max(1, costDisplayLines.length);
    const sectionAnchorY = viewModel.upgradeSectionTopY + costLineCount * 16 + 6;
    const upgradeButtonDisabled = !interactionState.canUpgradeAction || upgradeState.isUpgrading;
    const moveButtonDisabled = upgradeState.isUpgrading || upgradeState.isPreparingMove;
    const feedbackFallback = interactionState.blockedReason
      ? {
          text: interactionState.blockedReason,
          color: theme.dangerText,
        }
      : null;
    const feedbackMessage = upgradeState.feedbackMessage ?? feedbackFallback;

    ui.upgradeCostText
      .setPosition(leftX, viewModel.upgradeSectionTopY)
      .setText(costDisplayLines.join('\n'));
    ui.upgradeLabel
      .setPosition(leftX, sectionAnchorY + 8)
      .setText(`改築操作: ${interactionState.toLevelLabel}`);
    ui.upgradeButtonBackground.setPosition(panelWidth / 2 - 60, sectionAnchorY + 20);
    ui.upgradeButtonText
      .setPosition(panelWidth / 2 - 60, sectionAnchorY + 20)
      .setText(upgradeState.isUpgrading ? '改築中...' : interactionState.defaultUpgradeButtonLabel);
    ui.moveButtonBackground.setPosition(panelWidth / 2 - 60, sectionAnchorY + 52);
    ui.moveButtonText
      .setPosition(panelWidth / 2 - 60, sectionAnchorY + 52)
      .setText(upgradeState.isPreparingMove ? '移動中...' : '移動');
    ui.upgradeFeedback
      .setPosition(leftX, sectionAnchorY + 30)
      .setText(feedbackMessage?.text ?? '')
      .setColor(feedbackMessage?.color ?? theme.mutedText);

    ui.upgradeButtonBackground
      .setFillStyle(
        upgradeButtonDisabled ? theme.upgradeButtonDisabledFill : theme.upgradeButtonEnabledFill,
        upgradeButtonDisabled ? 0.45 : 0.9
      )
      .setStrokeStyle(
        1.5,
        upgradeButtonDisabled
          ? theme.upgradeButtonDisabledStroke
          : theme.upgradeButtonEnabledStroke,
        0.95
      );
    ui.upgradeButtonText.setColor(
      upgradeButtonDisabled ? theme.upgradeButtonDisabledText : theme.upgradeButtonEnabledText
    );
    if (upgradeButtonDisabled) {
      ui.upgradeButtonBackground.disableInteractive();
    } else {
      ui.upgradeButtonBackground.setInteractive({ useHandCursor: true });
    }

    ui.moveButtonBackground
      .setFillStyle(moveButtonDisabled ? 0x334155 : 0x0b2942, moveButtonDisabled ? 0.35 : 0.62)
      .setStrokeStyle(1.5, moveButtonDisabled ? 0x64748b : 0x7dd3fc, 0.95);
    ui.moveButtonText.setColor(moveButtonDisabled ? '#cbd5e1' : '#e0f2fe');
    if (moveButtonDisabled) {
      ui.moveButtonBackground.disableInteractive();
    } else {
      ui.moveButtonBackground.setInteractive({ useHandCursor: true });
    }
  }

  private buildPopupUi(
    viewModel: PopupViewModel,
    upgradeState: UpgradeSectionState
  ): PopupUiElements {
    const scene = this.dependencies.scene;
    const { theme, panelWidth, panelHeight } = viewModel;
    const leftX = -panelWidth / 2 + POPUP_HORIZONTAL_PADDING;
    const container = scene.add
      .container(viewModel.popupX, viewModel.popupY)
      .setDepth(BUILDING_POPUP_DEPTH);
    const panel = scene.add
      .rectangle(0, 0, panelWidth, panelHeight, theme.panelFill, theme.panelFillAlpha)
      .setStrokeStyle(2, theme.panelStroke, 0.9)
      .setOrigin(0.5);
    panel.setInteractive({ useHandCursor: false });
    panel.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _x: number,
        _y: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
      }
    );

    const title = scene.add
      .text(
        leftX,
        -panelHeight / 2 + 12,
        `${this.dependencies.resolveBuildingLabel(viewModel.payload.type)}  Lv.${viewModel.normalizedLevel}`,
        {
          fontFamily: '"Noto Serif JP", serif',
          fontSize: '14px',
          color: theme.titleText,
          fontStyle: 'bold',
        }
      )
      .setOrigin(0, 0);
    const statusColor =
      viewModel.status === '障害中'
        ? theme.statusBlockedText
        : viewModel.status === '作業中'
          ? theme.statusWorkingText
          : theme.statusIdleText;
    const statusText = scene.add
      .text(leftX, -panelHeight / 2 + 40, `現在の作業状態: ${viewModel.status}`, {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: statusColor,
      })
      .setOrigin(0, 0);

    const rewardRatesY = -panelHeight / 2 + 62;
    let currentInfoY = rewardRatesY;
    const rewardRateText =
      viewModel.rewardRateDisplayLines.length > 0
        ? scene.add
            .text(leftX, currentInfoY, viewModel.rewardRateDisplayLines.join('\n'), {
              fontFamily: '"Noto Sans JP", sans-serif',
              fontSize: '11px',
              color: theme.rewardText,
              lineSpacing: 2,
            })
            .setOrigin(0, 0)
        : null;
    if (viewModel.rewardRateDisplayLines.length > 0) {
      currentInfoY += viewModel.rewardRateDisplayLines.length * 16 + 4;
    }
    const dropText =
      viewModel.materialDropDisplayLines.length > 0
        ? scene.add
            .text(leftX, currentInfoY, viewModel.materialDropDisplayLines.join('\n'), {
              fontFamily: '"Noto Sans JP", sans-serif',
              fontSize: '11px',
              color: theme.dropText,
              lineSpacing: 2,
            })
            .setOrigin(0, 0)
        : null;
    const workersHeadingY = viewModel.upgradeSectionTopY + UPGRADE_SECTION_HEIGHT;
    const workersHeading = scene.add
      .text(
        leftX,
        workersHeadingY,
        viewModel.showInlineAssignee
          ? `配置中: ${viewModel.assignees.join(' / ')}`
          : '配置中の足軽:',
        {
          fontFamily: '"Noto Sans JP", sans-serif',
          fontSize: '12px',
          color: theme.primaryText,
          fontStyle: 'bold',
        }
      )
      .setOrigin(0, 0);
    const workersText = scene.add
      .text(
        leftX + 2,
        workersHeadingY + 20,
        viewModel.showInlineAssignee
          ? ''
          : viewModel.assignees.length > 0
            ? viewModel.assignees.map((name) => `・${name}`).join('\n')
            : '・配置なし',
        {
          fontFamily: '"Noto Sans JP", sans-serif',
          fontSize: '12px',
          color: theme.statusIdleText,
          lineSpacing: 2,
        }
      )
      .setOrigin(0, 0);
    const closeButton = scene.add
      .text(panelWidth / 2 - 14, -panelHeight / 2 + 10, '閉じる', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '11px',
        color: theme.closeButtonText,
        backgroundColor: theme.closeButtonBackground,
        padding: { left: 6, right: 6, top: 2, bottom: 2 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    closeButton.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _x: number,
        _y: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
        this.close();
      }
    );

    const upgradeCostText = scene.add
      .text(leftX, viewModel.upgradeSectionTopY, '', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '11px',
        color: theme.upgradeCostText,
        lineSpacing: 2,
      })
      .setOrigin(0, 0);
    const upgradeLabel = scene.add
      .text(leftX, viewModel.upgradeSectionTopY + 8, '', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: theme.primaryText,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    const upgradeButtonBackground = scene.add
      .rectangle(
        panelWidth / 2 - 60,
        viewModel.upgradeSectionTopY + 20,
        92,
        24,
        theme.upgradeButtonDisabledFill,
        0.45
      )
      .setStrokeStyle(1.5, theme.upgradeButtonDisabledStroke, 0.95)
      .setOrigin(0.5);
    const upgradeButtonText = scene.add
      .text(panelWidth / 2 - 60, viewModel.upgradeSectionTopY + 20, '', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: theme.upgradeButtonDisabledText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const moveButtonBackground = scene.add
      .rectangle(panelWidth / 2 - 60, viewModel.upgradeSectionTopY + 52, 92, 24, 0x334155, 0.35)
      .setStrokeStyle(1.5, 0x64748b, 0.95)
      .setOrigin(0.5);
    const moveButtonText = scene.add
      .text(panelWidth / 2 - 60, viewModel.upgradeSectionTopY + 52, '移動', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: '#cbd5e1',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const upgradeFeedback = scene.add
      .text(leftX, viewModel.upgradeSectionTopY + 30, '', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '11px',
        color: theme.mutedText,
      })
      .setOrigin(0, 0);

    const popupElements: Phaser.GameObjects.GameObject[] = [panel, title, statusText];
    if (rewardRateText) {
      popupElements.push(rewardRateText);
    }
    if (dropText) {
      popupElements.push(dropText);
    }
    popupElements.push(
      upgradeCostText,
      upgradeLabel,
      upgradeButtonBackground,
      upgradeButtonText,
      moveButtonBackground,
      moveButtonText,
      upgradeFeedback,
      workersHeading,
      workersText,
      closeButton
    );
    container.add(popupElements);

    const ui: PopupUiElements = {
      container,
      upgradeCostText,
      upgradeLabel,
      upgradeButtonBackground,
      upgradeButtonText,
      moveButtonBackground,
      moveButtonText,
      upgradeFeedback,
    };
    this.refreshUpgradeSectionUi(viewModel, upgradeState, ui);
    return ui;
  }

  private bindPopupActionHandlers(
    viewModel: PopupViewModel,
    upgradeState: UpgradeSectionState,
    ui: PopupUiElements,
    renderVersion: number
  ): void {
    const { payload, normalizedLevel, theme } = viewModel;
    ui.upgradeButtonBackground.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
        const interactionState = this.resolveUpgradeInteractionState(upgradeState);
        if (!interactionState.canUpgradeAction || upgradeState.isUpgrading) {
          return;
        }

        upgradeState.isUpgrading = true;
        upgradeState.feedbackMessage = {
          text: '改築中でござる...',
          color: theme.statusWorkingText,
        };
        this.refreshUpgradeSectionUi(viewModel, upgradeState, ui);
        void this.dependencies
          .requestBuildingUpgrade(payload.type, normalizedLevel)
          .then((result) => {
            if (this.popupRenderVersion !== renderVersion) {
              return;
            }

            if (!result.success || result.nextLevel === null) {
              upgradeState.isUpgrading = false;
              upgradeState.feedbackMessage = {
                text: result.message,
                color: theme.dangerText,
              };
              this.refreshUpgradeSectionUi(viewModel, upgradeState, ui);
              return;
            }

            const nextStatus = this.dependencies.resolveBuildingPopupStatus(payload.type);
            const nextAssignees = this.dependencies.getAssignedWorkersWithElapsedForBuilding(
              payload.type
            );
            void this.open(
              {
                ...payload,
                level: result.nextLevel,
              },
              nextStatus,
              nextAssignees,
              {
                text: result.message,
                color: theme.successText,
              }
            );
          })
          .catch(() => {
            if (this.popupRenderVersion !== renderVersion) {
              return;
            }

            upgradeState.isUpgrading = false;
            upgradeState.feedbackMessage = {
              text: '改築に失敗いたした。',
              color: theme.dangerText,
            };
            this.refreshUpgradeSectionUi(viewModel, upgradeState, ui);
          });
      }
    );
    ui.moveButtonBackground.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
        if (upgradeState.isUpgrading || upgradeState.isPreparingMove) {
          return;
        }

        if (typeof window === 'undefined') {
          return;
        }

        upgradeState.isPreparingMove = true;
        this.refreshUpgradeSectionUi(viewModel, upgradeState, ui);
        window.dispatchEvent(
          new CustomEvent(BUILDING_PLACEMENT_START_EVENT, {
            detail: {
              buildingId: payload.type,
              mode: 'move' as const,
            },
          })
        );
        this.close();
      }
    );
  }

  private async hydrateUpgradeSection(
    viewModel: PopupViewModel,
    upgradeState: UpgradeSectionState,
    ui: PopupUiElements,
    renderVersion: number
  ): Promise<void> {
    if (!upgradeState.loading) {
      return;
    }

    let info: PopupUpgradeCostInfo;
    try {
      info = await this.dependencies.resolveUpgradeCostInfo(
        viewModel.payload.type,
        viewModel.normalizedLevel
      );
    } catch {
      info = this.createUpgradeCostErrorInfo();
    }

    if (this.popupRenderVersion !== renderVersion) {
      return;
    }

    upgradeState.loading = false;
    upgradeState.info = info;
    this.refreshUpgradeSectionUi(viewModel, upgradeState, ui);
  }

  public async open(
    payload: BuildingClickPayload,
    status: BuildingPopupStatus,
    assignees: string[],
    initialMessage?: OpenPopupMessage
  ): Promise<void> {
    this.close();
    const renderVersion = this.popupRenderVersion + 1;
    this.popupRenderVersion = renderVersion;
    const normalizedPayloadResult = normalizePopupPayload(payload, this.dependencies.normalizeBuildingLevel);
    const normalizedPayload = normalizedPayloadResult.payload;
    const normalizedLevel = this.dependencies.normalizeBuildingLevel(normalizedPayload.level);
    const theme = this.resolveThemeTokens();
    const resolvedStatus =
      normalizedPayload.type === payload.type
        ? status
        : this.dependencies.resolveBuildingPopupStatus(normalizedPayload.type);
    const resolvedAssignees =
      normalizedPayload.type === payload.type
        ? assignees
        : this.dependencies.getAssignedWorkersWithElapsedForBuilding(normalizedPayload.type);
    const resolvedInitialMessage =
      normalizedPayloadResult.missingDataMessage !== null
        ? {
            text: normalizedPayloadResult.missingDataMessage,
            color: theme.dangerText,
          }
        : initialMessage;
    const upgradeState = this.createInitialUpgradeSectionState(normalizedPayload, resolvedInitialMessage);
    if (normalizedPayloadResult.missingDataMessage !== null) {
      upgradeState.loading = false;
      upgradeState.info = this.createUpgradeCostErrorInfo();
    }
    const viewModel = this.createPopupViewModel(
      normalizedPayload,
      resolvedStatus,
      resolvedAssignees,
      normalizedLevel,
      theme,
      upgradeState.loading
    );
    const popupUi = this.buildPopupUi(viewModel, upgradeState);
    this.bindPopupActionHandlers(viewModel, upgradeState, popupUi, renderVersion);
    this.buildingPopup = popupUi.container;
    this.suppressPopupAutoClose = true;
    this.dependencies.scene.time.delayedCall(0, () => {
      this.suppressPopupAutoClose = false;
    });
    if (upgradeState.loading) {
      void this.hydrateUpgradeSection(viewModel, upgradeState, popupUi, renderVersion);
    }
  }

  public isPointerInside(pointer: Phaser.Input.Pointer): boolean {
    if (!this.buildingPopup) {
      return false;
    }

    const bounds = this.buildingPopup.getBounds();
    return bounds.contains(pointer.worldX, pointer.worldY);
  }

  public handlePointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (!this.buildingPopup) {
      return false;
    }

    if (this.suppressPopupAutoClose) {
      return true;
    }

    if (!this.isPointerInside(pointer)) {
      this.close();
    }

    return true;
  }

  public close(): void {
    this.popupRenderVersion += 1;
    if (!this.buildingPopup) {
      return;
    }

    this.buildingPopup.destroy(true);
    this.buildingPopup = null;
  }

  public destroy(): void {
    this.close();
  }
}
