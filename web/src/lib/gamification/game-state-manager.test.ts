import { describe, expect, it, vi } from 'vitest';
import { TOWN_LEVEL_XP_THRESHOLDS } from '../../types/game';
import {
  createGameStateManager,
  createInitialGameState,
  getGameState,
  loadOrCreateGameState,
  mergeGameState,
  postGameState,
} from './game-state-manager';

const createFetchResponse = (payload: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => payload,
  }) as unknown as Response;

const toFetch = (mock: ReturnType<typeof vi.fn>): typeof fetch => mock as unknown as typeof fetch;

const createActivityLog = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `log-${index + 1}`,
    type: 'work_complete' as const,
    timestamp: `2026-02-09T00:${String(index).padStart(2, '0')}:00.000Z`,
    message: `log ${index + 1}`,
  }));

describe('game-state-manager', () => {
  it('parses wrapped and legacy payloads from GET /api/game-state', async () => {
    const wrappedState = createInitialGameState();

    const wrappedFetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        success: true,
        data: {
          state: wrappedState,
        },
      })
    );

    const wrapped = await getGameState('http://localhost:3210', toFetch(wrappedFetch));
    expect(wrapped).toEqual(wrappedState);
    expect(wrappedFetch).toHaveBeenCalledWith('http://localhost:3210/api/game-state', {
      method: 'GET',
    });

    const legacyFetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        gameState: wrappedState,
      })
    );

    const legacy = await getGameState('', toFetch(legacyFetch));
    expect(legacy).toEqual(wrappedState);
    expect(legacyFetch).toHaveBeenCalledWith('/api/game-state', {
      method: 'GET',
    });
  });

  it('parses wrapped payloads from POST /api/game-state', async () => {
    const state = createInitialGameState();
    const postFetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        success: true,
        data: {
          gameState: state,
        },
      })
    );

    const saved = await postGameState(state, '', toFetch(postFetch));
    expect(saved).toEqual(state);

    const [calledUrl, requestInit] = postFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('/api/game-state');
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers).toEqual({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(requestInit.body))).toEqual({
      state,
    });
  });

  it('handles boundary values in mergeGameState and clamps activity-log length', () => {
    const base = createInitialGameState();
    const firstThreshold = TOWN_LEVEL_XP_THRESHOLDS[1] ?? 150;

    const belowThreshold = mergeGameState(base, {
      town: {
        xp: firstThreshold - 1,
        level: Number.NaN,
      },
    });
    expect(belowThreshold.town.level).toBe(1);

    const atThreshold = mergeGameState(base, {
      town: {
        xp: firstThreshold,
        level: Number.NaN,
      },
    });
    expect(atThreshold.town.level).toBe(2);

    const negativePatchResult = mergeGameState(base, {
      town: {
        xp: -10,
        gold: -5,
      },
      activityLog: createActivityLog(101),
    });
    expect(negativePatchResult.town).toMatchObject({
      level: 1,
      xp: 0,
      gold: 0,
    });
    expect(negativePatchResult.economy.gold).toBe(0);
    expect(negativePatchResult.activityLog).toHaveLength(100);
    expect(negativePatchResult.activityLog[0]?.id).toBe('log-2');

    const nanPatchResult = mergeGameState(base, {
      town: {
        xp: Number.NaN,
        gold: Number.NaN,
      },
    });
    expect(Number.isNaN(nanPatchResult.town.xp)).toBe(true);
    expect(Number.isNaN(nanPatchResult.town.gold)).toBe(true);
  });

  it('falls back to initial state on load failure and throws on non-ok GET', async () => {
    const fallbackFetch = vi.fn().mockRejectedValue(new Error('network error'));
    const fallback = await loadOrCreateGameState('', toFetch(fallbackFetch));
    expect(fallback).toEqual(createInitialGameState());

    const failedFetch = vi.fn().mockResolvedValue(createFetchResponse({}, false, 503));
    await expect(getGameState('', toFetch(failedFetch))).rejects.toThrow(
      'GET /api/game-state failed: 503'
    );
  });

  it('wires createGameStateManager get/save methods with compatibility payloads', async () => {
    const state = createInitialGameState();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          success: true,
          data: {
            state,
          },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          success: true,
          data: {
            gameState: state,
          },
        })
      );

    const manager = createGameStateManager('http://localhost:7777', toFetch(fetchMock));

    const loaded = await manager.getState();
    const saved = await manager.saveState(state);

    expect(loaded).toEqual(state);
    expect(saved).toEqual(state);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(manager.createInitialState().ashigaru).toHaveLength(8);
  });
});
