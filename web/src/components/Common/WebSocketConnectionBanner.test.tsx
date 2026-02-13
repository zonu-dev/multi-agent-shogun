import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocketConnectionBanner from './WebSocketConnectionBanner';

afterEach(() => {
  cleanup();
});

describe('WebSocketConnectionBanner', () => {
  it('does not render while connected', () => {
    const { container } = render(<WebSocketConnectionBanner status="connected" reconnectAttempts={0} />);
    expect(container.textContent).toBe('');
  });

  it('shows connecting banner', () => {
    render(<WebSocketConnectionBanner status="connecting" reconnectAttempts={0} />);

    expect(screen.getByText('接続中...')).not.toBeNull();
    expect(screen.getByText('サーバーへ接続しています。')).not.toBeNull();
  });

  it('shows reconnecting message and attempt count', () => {
    render(<WebSocketConnectionBanner status="reconnecting" reconnectAttempts={2} />);

    expect(screen.getByText('再接続中...')).not.toBeNull();
    expect(screen.getByText('復旧を試みています（2回目）')).not.toBeNull();
    expect(screen.getByRole('button', { name: '再接続' })).not.toBeNull();
  });

  it('calls onReconnect when clicking reconnect button', () => {
    const onReconnect = vi.fn();
    render(
      <WebSocketConnectionBanner status="disconnected" reconnectAttempts={10} onReconnect={onReconnect} />
    );

    expect(screen.getByText('サーバーとの接続が切断されました')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再接続' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
