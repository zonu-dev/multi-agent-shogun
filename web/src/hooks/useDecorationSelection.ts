import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  DECORATION_CLICK_EVENT,
  JSON_HEADERS,
  POINTER_RECENCY_MS,
  POPUP_FALLBACK_HEIGHT,
  POPUP_FALLBACK_WIDTH,
  POPUP_TARGET_OFFSET_X,
  POPUP_TARGET_OFFSET_Y,
  POPUP_VIEWPORT_MARGIN,
  extractError,
  formatPassiveEffectText,
  isGameStatePayload,
  isRecord,
  normalizeSelectedDecoration,
  resolveDecorationMeta,
  resolveDecorationUpgradeCost,
  toDecorationLevel,
  toPassiveEffect,
  type DecorationActionApiResponse,
  type DecorationOperationNotifier,
  type DecorationProcessingAction,
  type PendingPlacement,
  type PopupPosition,
  type ScreenPoint,
  type SelectedDecoration,
} from '@/hooks/decorationInteractionShared';
import type { GameState } from '@/types';

interface DecorationActionResult {
  ok: boolean;
  message?: string;
}

interface UseDecorationSelectionParams {
  pendingPlacement: PendingPlacement | null;
  notifyOperation: DecorationOperationNotifier;
  postDecorationAction: (url: string, payload: Record<string, unknown>) => Promise<DecorationActionResult>;
  updateGameState: (nextState: GameState) => void;
  startMovePlacement: (decorationType: string, decorationId: string) => boolean;
}

interface UseDecorationSelectionResult {
  panelRef: MutableRefObject<HTMLElement | null>;
  selectedDecoration: SelectedDecoration | null;
  selectedDecorationMeta: { emoji: string; label: string } | null;
  selectedDecorationUpgradeCost: number | null;
  selectedDecorationPassiveText: string;
  popupPosition: PopupPosition | null;
  processingAction: DecorationProcessingAction | null;
  clearSelectedDecoration: () => void;
  handleCollect: () => Promise<void>;
  handleMove: () => Promise<void>;
  handleUpgrade: () => Promise<void>;
}

export const useDecorationSelection = ({
  pendingPlacement,
  notifyOperation,
  postDecorationAction,
  updateGameState,
  startMovePlacement,
}: UseDecorationSelectionParams): UseDecorationSelectionResult => {
  const [selectedDecoration, setSelectedDecoration] = useState<SelectedDecoration | null>(null);
  const [processingAction, setProcessingAction] = useState<DecorationProcessingAction | null>(null);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);
  const lastPointerRef = useRef<{ point: ScreenPoint; timestamp: number } | null>(null);

  const selectedDecorationMeta = useMemo(
    () => (selectedDecoration ? resolveDecorationMeta(selectedDecoration.type) : null),
    [selectedDecoration]
  );
  const selectedDecorationUpgradeCost = useMemo(
    () =>
      selectedDecoration
        ? resolveDecorationUpgradeCost(selectedDecoration.type, selectedDecoration.level)
        : null,
    [selectedDecoration]
  );
  const selectedDecorationPassiveText = useMemo(
    () =>
      selectedDecoration
        ? formatPassiveEffectText(selectedDecoration.passiveEffect, selectedDecoration.level)
        : '',
    [selectedDecoration]
  );

  const clearSelectedDecoration = useCallback((): void => {
    setSelectedDecoration(null);
    setProcessingAction(null);
  }, []);

  const resolvePopupPosition = useCallback((anchor: ScreenPoint): PopupPosition => {
    const rect = panelRef.current?.getBoundingClientRect();
    const panelWidth = rect?.width ?? POPUP_FALLBACK_WIDTH;
    const panelHeight = rect?.height ?? POPUP_FALLBACK_HEIGHT;
    const minLeft = POPUP_VIEWPORT_MARGIN;
    const minTop = POPUP_VIEWPORT_MARGIN;
    const maxLeft = Math.max(minLeft, window.innerWidth - panelWidth - POPUP_VIEWPORT_MARGIN);
    const maxTop = Math.max(minTop, window.innerHeight - panelHeight - POPUP_VIEWPORT_MARGIN);
    const desiredLeft = anchor.x + POPUP_TARGET_OFFSET_X;
    const desiredTop = anchor.y - panelHeight - POPUP_TARGET_OFFSET_Y;

    return {
      left: Math.min(Math.max(desiredLeft, minLeft), maxLeft),
      top: Math.min(Math.max(desiredTop, minTop), maxTop),
    };
  }, []);

  const handleCollect = useCallback(async (): Promise<void> => {
    if (!selectedDecoration || processingAction !== null) {
      return;
    }

    setProcessingAction('collect');
    const result = await postDecorationAction('/api/collect-decoration', {
      decorationId: selectedDecoration.id,
    });

    if (!result.ok) {
      notifyOperation(result.message ?? '回収に失敗いたした。', 'error');
      setProcessingAction(null);
      return;
    }

    const meta = resolveDecorationMeta(selectedDecoration.type);
    setSelectedDecoration(null);
    notifyOperation(`${meta.label}を回収いたした。`, 'success');
    setProcessingAction(null);
  }, [notifyOperation, postDecorationAction, processingAction, selectedDecoration]);

  const handleMove = useCallback(async (): Promise<void> => {
    if (!selectedDecoration || processingAction !== null || pendingPlacement !== null) {
      return;
    }

    setProcessingAction('move');
    const result = await postDecorationAction('/api/collect-decoration', {
      decorationId: selectedDecoration.id,
    });

    if (!result.ok) {
      notifyOperation(result.message ?? '移動準備に失敗いたした。', 'error');
      setProcessingAction(null);
      return;
    }

    const started = startMovePlacement(selectedDecoration.type, selectedDecoration.id);
    if (started) {
      setSelectedDecoration(null);
    }

    setProcessingAction(null);
  }, [
    notifyOperation,
    pendingPlacement,
    postDecorationAction,
    processingAction,
    selectedDecoration,
    startMovePlacement,
  ]);

  const handleUpgrade = useCallback(async (): Promise<void> => {
    if (!selectedDecoration || processingAction !== null || pendingPlacement !== null) {
      return;
    }

    const upgradeCost = resolveDecorationUpgradeCost(selectedDecoration.type, selectedDecoration.level);
    if (upgradeCost === null) {
      notifyOperation('これ以上は強化できぬ。', 'error');
      return;
    }

    setProcessingAction('upgrade');

    try {
      const response = await fetch('/api/upgrade-decoration', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          decorationId: selectedDecoration.id,
        }),
      });
      const body = (await response.json().catch(() => null)) as DecorationActionApiResponse | null;

      if (!response.ok || body?.success !== true || !isGameStatePayload(body.gameState)) {
        notifyOperation(extractError(body, '強化に失敗いたした。'), 'error');
        setProcessingAction(null);
        return;
      }

      updateGameState(body.gameState);
      const updatedLevel = toDecorationLevel(
        isRecord(body.decoration) ? body.decoration.level : selectedDecoration.level + 1
      );
      const updatedPassive = toPassiveEffect(
        isRecord(body.decoration) ? body.decoration.passiveEffect : selectedDecoration.passiveEffect
      );
      setSelectedDecoration((current) =>
        current
          ? {
              ...current,
              level: updatedLevel,
              passiveEffect: updatedPassive,
            }
          : current
      );
      const meta = resolveDecorationMeta(selectedDecoration.type);
      notifyOperation(`${meta.label}をLv${updatedLevel}へ強化。-${upgradeCost}両`, 'success');
    } catch {
      notifyOperation('強化に失敗いたした。通信が乱れた。', 'error');
    } finally {
      setProcessingAction(null);
    }
  }, [notifyOperation, pendingPlacement, processingAction, selectedDecoration, updateGameState]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return;
      }

      lastPointerRef.current = {
        point: { x: event.clientX, y: event.clientY },
        timestamp: Date.now(),
      };
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || selectedDecoration === null) {
      setPopupPosition(null);
      return;
    }

    const fallbackAnchor: ScreenPoint = {
      x: window.innerWidth / 2,
      y: Math.max(POPUP_VIEWPORT_MARGIN + 120, window.innerHeight * 0.65),
    };
    const anchor = selectedDecoration.screen ?? fallbackAnchor;
    setPopupPosition(resolvePopupPosition(anchor));
  }, [resolvePopupPosition, selectedDecoration]);

  useEffect(() => {
    if (typeof window === 'undefined' || selectedDecoration === null) {
      return;
    }

    const refreshPosition = (): void => {
      const fallbackAnchor: ScreenPoint = {
        x: window.innerWidth / 2,
        y: Math.max(POPUP_VIEWPORT_MARGIN + 120, window.innerHeight * 0.65),
      };
      const anchor = selectedDecoration.screen ?? fallbackAnchor;
      setPopupPosition(resolvePopupPosition(anchor));
    };

    window.addEventListener('resize', refreshPosition);
    window.addEventListener('scroll', refreshPosition, true);
    return () => {
      window.removeEventListener('resize', refreshPosition);
      window.removeEventListener('scroll', refreshPosition, true);
    };
  }, [resolvePopupPosition, selectedDecoration]);

  useEffect(() => {
    if (typeof window === 'undefined' || selectedDecoration === null) {
      return;
    }

    const handlePointerDownOutside = (event: PointerEvent): void => {
      const panelElement = panelRef.current;
      if (!panelElement) {
        clearSelectedDecoration();
        return;
      }

      const eventTarget = event.target;
      if (eventTarget instanceof Node && panelElement.contains(eventTarget)) {
        return;
      }

      clearSelectedDecoration();
    };

    window.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside, true);
    };
  }, [clearSelectedDecoration, selectedDecoration]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleDecorationClick = (event: Event): void => {
      const detail = normalizeSelectedDecoration((event as CustomEvent<unknown>).detail);
      if (!detail) {
        return;
      }

      if (pendingPlacement !== null) {
        return;
      }

      setProcessingAction(null);
      const fallbackPointer = lastPointerRef.current;
      const shouldUseFallbackPointer =
        detail.screen === null &&
        fallbackPointer !== null &&
        Date.now() - fallbackPointer.timestamp <= POINTER_RECENCY_MS;
      setSelectedDecoration({
        ...detail,
        screen: detail.screen ?? (shouldUseFallbackPointer ? fallbackPointer.point : null),
      });
    };

    window.addEventListener(DECORATION_CLICK_EVENT, handleDecorationClick as EventListener);
    return () => {
      window.removeEventListener(DECORATION_CLICK_EVENT, handleDecorationClick as EventListener);
    };
  }, [pendingPlacement]);

  return {
    panelRef,
    selectedDecoration,
    selectedDecorationMeta,
    selectedDecorationUpgradeCost,
    selectedDecorationPassiveText,
    popupPosition,
    processingAction,
    clearSelectedDecoration,
    handleCollect,
    handleMove,
    handleUpgrade,
  };
};
