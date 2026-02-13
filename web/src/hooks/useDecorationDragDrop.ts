import { useEffect } from 'react';
import {
  DECORATION_PLACEMENT_CANCEL_EVENT,
  DECORATION_PLACEMENT_COMMIT_EVENT,
  resolveDecorationMeta,
  toDecorationType,
  type DecorationOperationNotifier,
  type DecorationPlacementCancelDetail,
  type DecorationPlacementCommitDetail,
  type PendingPlacement,
} from '@/hooks/decorationInteractionShared';

interface DecorationActionResult {
  ok: boolean;
  message?: string;
}

interface UseDecorationDragDropParams {
  pendingPlacement: PendingPlacement | null;
  clearPendingPlacement: () => void;
  notifyOperation: DecorationOperationNotifier;
  postDecorationAction: (url: string, payload: Record<string, unknown>) => Promise<DecorationActionResult>;
}

export const useDecorationDragDrop = ({
  pendingPlacement,
  clearPendingPlacement,
  notifyOperation,
  postDecorationAction,
}: UseDecorationDragDropParams): void => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleCommit = (event: Event): void => {
      if (!pendingPlacement) {
        return;
      }

      const detail = (event as CustomEvent<DecorationPlacementCommitDetail>).detail;
      const committedType = toDecorationType(detail?.decorationType);
      if (committedType && committedType !== pendingPlacement.decorationType) {
        return;
      }

      const x =
        typeof detail?.position?.x === 'number' && Number.isFinite(detail.position.x)
          ? Math.floor(detail.position.x)
          : null;
      const y =
        typeof detail?.position?.y === 'number' && Number.isFinite(detail.position.y)
          ? Math.floor(detail.position.y)
          : null;

      if (x === null || y === null) {
        clearPendingPlacement();
        notifyOperation('配置不能でござる。座標が不正であった。', 'error');
        return;
      }

      const request =
        pendingPlacement.mode === 'move' && pendingPlacement.decorationId
          ? {
              url: '/api/move-decoration',
              payload: {
                decorationId: pendingPlacement.decorationId,
                position: { x, y },
              },
            }
          : {
              url: '/api/place-decoration',
              payload: {
                decorationType: pendingPlacement.decorationType,
                position: { x, y },
              },
            };

      const meta = resolveDecorationMeta(pendingPlacement.decorationType);
      clearPendingPlacement();
      void (async () => {
        const result = await postDecorationAction(request.url, request.payload);
        if (!result.ok) {
          notifyOperation(result.message ?? '装飾の配置に失敗いたした。', 'error');
          return;
        }

        notifyOperation(`${meta.label}を設置いたした。`, 'success');
      })();
    };

    const handleCancel = (event: Event): void => {
      if (!pendingPlacement) {
        return;
      }

      const detail = (event as CustomEvent<DecorationPlacementCancelDetail>).detail;
      clearPendingPlacement();
      notifyOperation(detail?.message?.trim() || '配置を取り止めた。');
    };

    window.addEventListener(DECORATION_PLACEMENT_COMMIT_EVENT, handleCommit as EventListener);
    window.addEventListener(DECORATION_PLACEMENT_CANCEL_EVENT, handleCancel as EventListener);

    return () => {
      window.removeEventListener(DECORATION_PLACEMENT_COMMIT_EVENT, handleCommit as EventListener);
      window.removeEventListener(DECORATION_PLACEMENT_CANCEL_EVENT, handleCancel as EventListener);
    };
  }, [clearPendingPlacement, notifyOperation, pendingPlacement, postDecorationAction]);
};
