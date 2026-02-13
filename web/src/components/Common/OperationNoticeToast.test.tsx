import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPERATION_NOTICE_POPUP_TYPE } from '@/lib/ui/operationNotice';
import { useUIStore } from '@/store/uiStore';
import OperationNoticeToast from './OperationNoticeToast';

afterEach(() => {
  cleanup();
  useUIStore.setState({
    selectedAshigaru: null,
    activePopup: null,
  });
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('OperationNoticeToast', () => {
  it('auto dismisses non-error notices', () => {
    vi.useFakeTimers();
    useUIStore.setState({
      activePopup: {
        type: OPERATION_NOTICE_POPUP_TYPE,
        data: {
          message: '通常通知',
          tone: 'info',
        },
      },
    });

    render(<OperationNoticeToast />);
    expect(screen.getByText('通常通知')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(4500);
    });

    expect(useUIStore.getState().activePopup).toBeNull();
  });

  it('keeps error notices until manually closed', () => {
    vi.useFakeTimers();
    useUIStore.setState({
      activePopup: {
        type: OPERATION_NOTICE_POPUP_TYPE,
        data: {
          message: '失敗通知',
          tone: 'error',
        },
      },
    });

    render(<OperationNoticeToast />);
    const closeButton = screen.getByRole('button', { name: '通知を閉じる' });
    expect(closeButton).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(useUIStore.getState().activePopup?.type).toBe(OPERATION_NOTICE_POPUP_TYPE);

    fireEvent.click(closeButton);
    expect(useUIStore.getState().activePopup).toBeNull();
  });
});
