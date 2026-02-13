import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DECORATION_INVENTORY_PLACE_REQUEST_EVENT,
  DECORATION_PLACEMENT_CANCEL_EVENT,
  DECORATION_PLACEMENT_START_EVENT,
  resolveDecorationMeta,
  toDecorationType,
  type DecorationInventoryPlaceRequestDetail,
  type DecorationOperationNotifier,
  type PendingPlacement,
} from '@/hooks/decorationInteractionShared';

interface UseDecorationPlacementParams {
  notifyOperation: DecorationOperationNotifier;
}

interface UseDecorationPlacementResult {
  pendingPlacement: PendingPlacement | null;
  startMovePlacement: (decorationType: string, decorationId: string) => boolean;
  clearPendingPlacement: () => void;
  requestPlacementCancel: () => void;
}

export const useDecorationPlacement = ({
  notifyOperation,
}: UseDecorationPlacementParams): UseDecorationPlacementResult => {
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const pendingPlacementRef = useRef<PendingPlacement | null>(null);

  const setPendingPlacementState = useCallback((next: PendingPlacement | null): void => {
    pendingPlacementRef.current = next;
    setPendingPlacement(next);
  }, []);

  const dispatchPlacementStart = useCallback((decorationType: string): void => {
    if (typeof window === 'undefined') {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(DECORATION_PLACEMENT_START_EVENT, {
        detail: {
          decorationType,
        },
      })
    );
  }, []);

  const startPlacement = useCallback(
    (next: PendingPlacement): boolean => {
      if (pendingPlacementRef.current !== null) {
        notifyOperation('既に配置先を選択中でござる。', 'error');
        return false;
      }

      const meta = resolveDecorationMeta(next.decorationType);
      const message =
        next.mode === 'move'
          ? `${meta.label}の移動先を地図で選ぶでござる。`
          : `${meta.label}の設置場所を地図で選ぶでござる。`;

      setPendingPlacementState(next);
      notifyOperation(message);
      dispatchPlacementStart(next.decorationType);
      return true;
    },
    [dispatchPlacementStart, notifyOperation, setPendingPlacementState]
  );

  const startMovePlacement = useCallback(
    (decorationType: string, decorationId: string): boolean =>
      startPlacement({
        mode: 'move',
        decorationType,
        decorationId,
      }),
    [startPlacement]
  );

  const clearPendingPlacement = useCallback((): void => {
    setPendingPlacementState(null);
  }, [setPendingPlacementState]);

  const requestPlacementCancel = useCallback((): void => {
    const current = pendingPlacementRef.current;
    if (!current || typeof window === 'undefined') {
      return;
    }

    const meta = resolveDecorationMeta(current.decorationType);
    window.dispatchEvent(
      new CustomEvent(DECORATION_PLACEMENT_CANCEL_EVENT, {
        detail: {
          message: `${meta.label}の配置を取り止めた。`,
        },
      })
    );
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleInventoryPlaceRequest = (event: Event): void => {
      const detail = (event as CustomEvent<DecorationInventoryPlaceRequestDetail>).detail;
      const decorationType = toDecorationType(detail?.decorationType);
      if (!decorationType) {
        return;
      }

      startPlacement({
        mode: 'inventory',
        decorationType,
        decorationId: null,
      });
    };

    window.addEventListener(
      DECORATION_INVENTORY_PLACE_REQUEST_EVENT,
      handleInventoryPlaceRequest as EventListener
    );

    return () => {
      window.removeEventListener(
        DECORATION_INVENTORY_PLACE_REQUEST_EVENT,
        handleInventoryPlaceRequest as EventListener
      );
    };
  }, [startPlacement]);

  return {
    pendingPlacement,
    startMovePlacement,
    clearPendingPlacement,
    requestPlacementCancel,
  };
};
