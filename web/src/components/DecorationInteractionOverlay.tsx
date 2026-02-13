import { useCallback } from 'react';
import DecorationPlacementStatusBar from '@/components/DecorationPlacementStatusBar';
import DecorationSelectionPanel from '@/components/DecorationSelectionPanel';
import {
  JSON_HEADERS,
  extractError,
  isGameStatePayload,
  type DecorationActionApiResponse,
} from '@/hooks/decorationInteractionShared';
import { useDecorationDragDrop } from '@/hooks/useDecorationDragDrop';
import { useDecorationPlacement } from '@/hooks/useDecorationPlacement';
import { useDecorationSelection } from '@/hooks/useDecorationSelection';
import { showOperationNotice, type OperationNoticeTone } from '@/lib/ui/operationNotice';
import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';

interface DecorationActionResult {
  ok: boolean;
  message?: string;
}

const DecorationInteractionOverlay = () => {
  const updateGameState = useGameStore((state) => state.updateGameState);
  const openPopup = useUIStore((state) => state.openPopup);

  const notifyOperation = useCallback(
    (message: string, tone: OperationNoticeTone = 'info') => {
      showOperationNotice(openPopup, message, { tone });
    },
    [openPopup]
  );

  const postDecorationAction = useCallback(
    async (url: string, payload: Record<string, unknown>): Promise<DecorationActionResult> => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => null)) as DecorationActionApiResponse | null;

        if (!response.ok || body?.success !== true || !isGameStatePayload(body.gameState)) {
          return {
            ok: false,
            message: extractError(body, '装飾処理に失敗いたした。'),
          };
        }

        updateGameState(body.gameState);
        return { ok: true };
      } catch {
        return {
          ok: false,
          message: '装飾処理に失敗いたした。通信が乱れた。',
        };
      }
    },
    [updateGameState]
  );

  const { pendingPlacement, startMovePlacement, clearPendingPlacement, requestPlacementCancel } =
    useDecorationPlacement({
      notifyOperation,
    });

  useDecorationDragDrop({
    pendingPlacement,
    clearPendingPlacement,
    notifyOperation,
    postDecorationAction,
  });

  const {
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
  } = useDecorationSelection({
    pendingPlacement,
    notifyOperation,
    postDecorationAction,
    updateGameState,
    startMovePlacement,
  });

  return (
    <>
      <DecorationPlacementStatusBar
        pendingPlacement={pendingPlacement}
        onCancel={requestPlacementCancel}
      />
      {selectedDecoration && selectedDecorationMeta ? (
        <DecorationSelectionPanel
          panelRef={panelRef}
          selectedDecoration={selectedDecoration}
          selectedDecorationMeta={selectedDecorationMeta}
          selectedDecorationPassiveText={selectedDecorationPassiveText}
          selectedDecorationUpgradeCost={selectedDecorationUpgradeCost}
          popupPosition={popupPosition}
          processingAction={processingAction}
          isPlacementPending={pendingPlacement !== null}
          onClose={clearSelectedDecoration}
          onCollect={handleCollect}
          onMove={handleMove}
          onUpgrade={handleUpgrade}
        />
      ) : null}
    </>
  );
};

export default DecorationInteractionOverlay;
