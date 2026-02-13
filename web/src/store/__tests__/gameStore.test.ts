import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/gameStore';
import type { BuildingType, GameState, ItemDefinition } from '@/types';

interface MockFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const SAMPLE_ITEM: ItemDefinition = {
  id: 'consumable_repair_kit',
  name: '修理道具',
  description: '設備を整える試験用アイテム',
  itemType: 'consumable',
  rarity: 'common',
  effect: {
    type: 'town_gold_boost',
    value: 5,
  },
  usable: true,
  stackable: true,
  shopCost: 25,
};

const createBaseGameState = (): GameState => ({
  ashigaru: [],
  buildings: [
    { type: 'castle', level: 1, position: { x: 0, y: 0 } },
    { type: 'dojo', level: 1, position: { x: 1, y: 0 } },
  ],
  town: { level: 1, xp: 0, gold: 100 },
  economy: { gold: 100 },
  inventory: [],
  decorations: [],
  missions: [],
  activityLog: [],
  achievements: [],
  titles: [],
  equippedTitle: null,
  dailyRecords: [],
  materialCollection: [],
  lastMaterialDrop: null,
});

const createFetchResponse = (
  payload: unknown,
  overrides: Partial<Omit<MockFetchResponse, 'json'>> = {}
): MockFetchResponse => ({
  ok: overrides.ok ?? true,
  status: overrides.status ?? 200,
  json: async () => payload,
});

const createFetchSuccess = (): MockFetchResponse => createFetchResponse({});

const createBrokenJsonResponse = (): MockFetchResponse => ({
  ok: true,
  status: 200,
  json: async () => {
    throw new Error('broken json');
  },
});

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

const getPayload = (callIndex = 0): Record<string, unknown> => {
  const [, init] = getFetchMock().mock.calls[callIndex] as [string, RequestInit];
  const body = init?.body;
  if (typeof body !== 'string') {
    return {};
  }
  return JSON.parse(body) as Record<string, unknown>;
};

const getFetchMock = (): ReturnType<typeof vi.fn> => {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
};

let mockedNowMs = new Date('2026-02-09T00:00:00.000Z').getTime();

beforeEach(() => {
  mockedNowMs += 60_000;
  vi.spyOn(Date, 'now').mockReturnValue(mockedNowMs);

  const fetchMock = vi.fn().mockResolvedValue(createFetchSuccess());
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  useGameStore.getState().updateGameState(createBaseGameState());
});

afterEach(async () => {
  await Promise.resolve();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('gameStore optimistic actions', () => {
  it('addTownXP updates town state before persistence resolves', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    const deferred = createDeferred<MockFetchResponse>();
    getFetchMock().mockReturnValueOnce(deferred.promise);

    act(() => {
      result.current.addTownXP({
        category: 'new_implementation',
        completionTimeMinutes: 1,
        completionStreak: 1,
      });
    });

    const town = result.current.gameState?.town;
    expect(town).toMatchObject({ xp: 150, gold: 100, level: 2 });

    await vi.waitFor(() => {
      expect(getFetchMock().mock.calls.length).toBeGreaterThan(0);
    });
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/api/update-town',
      expect.objectContaining({ method: 'POST' })
    );
    expect(getPayload()).toEqual({ level: 2, xp: 150, gold: 100 });

    deferred.resolve(createFetchSuccess());
    await deferred.promise;
    unmount();
  });

  it('addGold updates state and persists normalized town payload', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    act(() => {
      result.current.addGold(55);
    });

    const town = result.current.gameState?.town;
    expect(town).toMatchObject({ xp: 0, gold: 155, level: 1 });

    await vi.waitFor(() => {
      expect(getFetchMock().mock.calls.length).toBeGreaterThan(0);
    });
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/api/update-town',
      expect.objectContaining({ method: 'POST' })
    );
    expect(getPayload()).toEqual({ level: 1, xp: 0, gold: 155 });
    unmount();
  });

  it('upgradeBuilding increments existing building level and persists upgrade request', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    const deferred = createDeferred<MockFetchResponse>();
    getFetchMock().mockReturnValueOnce(deferred.promise);

    act(() => {
      result.current.upgradeBuilding('castle');
    });

    const state = result.current;
    const castle = state.gameState?.buildings.find((building) => building.type === 'castle');
    expect(castle?.level).toBe(2);
    expect(state.buildingLevels.castle).toBe(2);
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/api/upgrade-building',
      expect.objectContaining({ method: 'POST' })
    );
    expect(getPayload()).toEqual({ buildingId: 'castle', newLevel: 2 });

    deferred.resolve(createFetchSuccess());
    await deferred.promise;
    unmount();
  });

  it('upgradeBuilding adds a missing building and persists level 1', () => {
    const { result, unmount } = renderHook(() => useGameStore());
    const target: BuildingType = 'scriptorium';

    act(() => {
      result.current.upgradeBuilding(target);
    });

    const state = result.current;
    const added = state.gameState?.buildings.find((building) => building.type === target);
    expect(added).toMatchObject({ type: target, level: 1, position: { x: 0, y: 0 } });
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/api/upgrade-building',
      expect.objectContaining({ method: 'POST' })
    );
    expect(getPayload()).toEqual({ buildingId: target, newLevel: 1 });
    unmount();
  });

  it('purchaseDecoration applies optimistic state update and persists normalized payload', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    const deferred = createDeferred<MockFetchResponse>();
    getFetchMock().mockReturnValueOnce(deferred.promise);

    act(() => {
      result.current.purchaseDecoration('stone_lantern', { x: 2.9, y: 3.2 });
    });

    const decorations = result.current.gameState?.decorations ?? [];
    const placedDecoration = decorations[decorations.length - 1];
    expect(placedDecoration).toMatchObject({
      type: 'stone_lantern',
      position: { x: 2, y: 3 },
    });
    expect(placedDecoration?.id.startsWith('stone_lantern-')).toBe(true);
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/api/purchase-decoration',
      expect.objectContaining({ method: 'POST' })
    );
    expect(getPayload()).toEqual({
      decorationId: 'stone_lantern',
      position: { x: 2, y: 3 },
    });

    deferred.resolve(createFetchSuccess());
    await deferred.promise;
    unmount();
  });
});

describe('gameStore item APIs', () => {
  it('loadItems applies catalog and inventory on API success', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(
      createFetchResponse({
        success: true,
        items: [SAMPLE_ITEM],
        inventory: [{ itemId: SAMPLE_ITEM.id, quantity: 2 }],
      })
    );

    await act(async () => {
      await result.current.loadItems();
    });

    expect(getFetchMock()).toHaveBeenCalledWith(
      '/api/items',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.current.itemCatalog).toEqual([
      expect.objectContaining({
        id: SAMPLE_ITEM.id,
        itemType: SAMPLE_ITEM.itemType,
        rarity: SAMPLE_ITEM.rarity,
      }),
    ]);
    expect(result.current.inventory).toEqual([{ itemId: SAMPLE_ITEM.id, quantity: 2 }]);
    expect(result.current.gameState?.inventory).toEqual([{ itemId: SAMPLE_ITEM.id, quantity: 2 }]);
    unmount();
  });

  it('loadItems deduplicates concurrent requests while one request is in-flight', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    const deferred = createDeferred<MockFetchResponse>();
    getFetchMock().mockReturnValueOnce(deferred.promise);

    const firstRequest = result.current.loadItems();
    const secondRequest = result.current.loadItems();

    expect(firstRequest).toBeDefined();
    expect(secondRequest).toBeDefined();
    expect(getFetchMock()).toHaveBeenCalledTimes(1);
    if (!firstRequest || !secondRequest) {
      throw new Error('Expected loadItems to return in-flight promise');
    }

    deferred.resolve(
      createFetchResponse({
        success: true,
        items: [SAMPLE_ITEM],
      })
    );
    await act(async () => {
      await Promise.all([firstRequest, secondRequest]);
    });
    unmount();
  });

  it('loadItems skips network call while cache TTL is still valid', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(
      createFetchResponse({
        success: true,
        items: [SAMPLE_ITEM],
        inventory: [],
      })
    );

    await act(async () => {
      await result.current.loadItems();
    });

    getFetchMock().mockClear();
    const secondCall = result.current.loadItems();
    await expect(secondCall).resolves.toBeUndefined();
    expect(getFetchMock()).not.toHaveBeenCalled();
    unmount();
  });

  it('loadItems handles HTTP failure without throwing', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(
      createFetchResponse(
        {
          success: false,
          error: 'items failed',
        },
        {
          ok: false,
          status: 500,
        }
      )
    );

    await expect(result.current.loadItems()).resolves.toBeUndefined();
    expect(getFetchMock()).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('loadItems retries when the previous response had broken JSON', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock()
      .mockResolvedValueOnce(createBrokenJsonResponse())
      .mockResolvedValueOnce(
        createFetchResponse({
          success: true,
          items: [SAMPLE_ITEM],
          inventory: [{ itemId: SAMPLE_ITEM.id, quantity: 1 }],
        })
      );

    await expect(result.current.loadItems()).resolves.toBeUndefined();
    await expect(result.current.loadItems()).resolves.toBeUndefined();

    expect(getFetchMock()).toHaveBeenCalledTimes(2);
    expect(result.current.inventory).toEqual([{ itemId: SAMPLE_ITEM.id, quantity: 1 }]);
    unmount();
  });

  it('consumeItem returns success and applies inventory payload', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(
      createFetchResponse({
        success: true,
        message: '使用成功',
        inventory: [{ itemId: SAMPLE_ITEM.id, quantity: 4 }],
      })
    );

    let actionResult: Awaited<ReturnType<typeof result.current.consumeItem>> | undefined;
    await act(async () => {
      actionResult = await result.current.consumeItem(SAMPLE_ITEM.id);
    });

    expect(actionResult).toEqual({ success: true, message: '使用成功' });
    expect(result.current.inventory).toEqual([{ itemId: SAMPLE_ITEM.id, quantity: 4 }]);
    unmount();
  });

  it('consumeItem returns API error message on HTTP failure', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(
      createFetchResponse(
        {
          success: false,
          error: 'use failed',
        },
        {
          ok: false,
          status: 400,
        }
      )
    );

    const actionResult = await result.current.consumeItem(SAMPLE_ITEM.id);
    expect(actionResult).toEqual({ success: false, message: 'use failed' });
    unmount();
  });

  it('consumeItem returns parse error when JSON payload is corrupted', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(createBrokenJsonResponse());

    const actionResult = await result.current.consumeItem(SAMPLE_ITEM.id);
    expect(actionResult).toEqual({
      success: false,
      message: '応答の解析に失敗いたした。時をおいて再試行されよ。',
    });
    unmount();
  });

  it('buyItem returns success and uses requested quantity', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(
      createFetchResponse({
        success: true,
        message: '購入成功',
        inventory: [{ itemId: SAMPLE_ITEM.id, quantity: 3 }],
      })
    );

    const actionResult = await result.current.buyItem(SAMPLE_ITEM.id, 3);

    expect(actionResult).toEqual({ success: true, message: '購入成功' });
    expect(getPayload()).toEqual({ itemId: SAMPLE_ITEM.id, quantity: 3 });
    expect(result.current.inventory).toEqual([{ itemId: SAMPLE_ITEM.id, quantity: 3 }]);
    unmount();
  });

  it('buyItem returns API error on HTTP failure', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(
      createFetchResponse(
        {
          success: false,
          error: 'buy failed',
        },
        {
          ok: false,
          status: 400,
        }
      )
    );

    const actionResult = await result.current.buyItem(SAMPLE_ITEM.id, 1);
    expect(actionResult).toEqual({ success: false, message: 'buy failed' });
    unmount();
  });

  it('buyItem returns parse error when JSON payload is corrupted', async () => {
    const { result, unmount } = renderHook(() => useGameStore());
    getFetchMock().mockResolvedValueOnce(createBrokenJsonResponse());

    const actionResult = await result.current.buyItem(SAMPLE_ITEM.id, 1);
    expect(actionResult).toEqual({
      success: false,
      message: '応答の解析に失敗いたした。時をおいて再試行されよ。',
    });
    unmount();
  });
});
