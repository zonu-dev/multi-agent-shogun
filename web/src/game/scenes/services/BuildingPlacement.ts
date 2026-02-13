import type { BuildingType } from '@/types';
import { resolveValidatedBuildingPlacements } from '../../objects/buildings/BuildingFactory';

export interface BuildingPlacement {
  type: BuildingType;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
}

export interface GridTile {
  x: number;
  y: number;
}

const DEFAULT_MAP_WIDTH = 16;
const DEFAULT_MAP_HEIGHT = 16;

const PATH_NEIGHBOR_OFFSETS: ReadonlyArray<GridTile> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DECORATION_NEIGHBOR_OFFSETS: ReadonlyArray<GridTile> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const clampToIntRange = (value: number, min: number, max: number): number => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : min;
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
};

export const resolveObstacleBuildingPlacements = (rawBuildings: unknown): BuildingPlacement[] =>
  resolveValidatedBuildingPlacements(rawBuildings).map((placement) => ({
    type: placement.type,
    tileX: placement.tileX,
    tileY: placement.tileY,
    width: placement.width,
    height: placement.height,
  }));

export const toTileKey = (tileX: number, tileY: number): string => `${tileX},${tileY}`;

export const fromTileKey = (value: string): GridTile => {
  const [tileXRaw, tileYRaw] = value.split(',');
  const tileX = Number.parseInt(tileXRaw, 10);
  const tileY = Number.parseInt(tileYRaw, 10);
  return {
    x: Number.isFinite(tileX) ? tileX : 0,
    y: Number.isFinite(tileY) ? tileY : 0,
  };
};

export const isTileInsideMap = (
  tileX: number,
  tileY: number,
  mapWidth: number = DEFAULT_MAP_WIDTH,
  mapHeight: number = DEFAULT_MAP_HEIGHT
): boolean => tileX >= 0 && tileX < mapWidth && tileY >= 0 && tileY < mapHeight;

export const createBlockedTilesFromPlacements = (
  placements: BuildingPlacement[],
  mapWidth: number = DEFAULT_MAP_WIDTH,
  mapHeight: number = DEFAULT_MAP_HEIGHT
): Set<string> => {
  const blocked = new Set<string>();

  for (const placement of placements) {
    for (let offsetY = 0; offsetY < placement.height; offsetY += 1) {
      for (let offsetX = 0; offsetX < placement.width; offsetX += 1) {
        const tileX = placement.tileX + offsetX;
        const tileY = placement.tileY + offsetY;
        if (!isTileInsideMap(tileX, tileY, mapWidth, mapHeight)) {
          continue;
        }

        blocked.add(toTileKey(tileX, tileY));
      }
    }
  }

  return blocked;
};

const getNeighborTiles = (tile: GridTile, mapWidth: number, mapHeight: number): GridTile[] => {
  const neighbors: GridTile[] = [];
  for (const offset of PATH_NEIGHBOR_OFFSETS) {
    const nextX = tile.x + offset.x;
    const nextY = tile.y + offset.y;
    if (!isTileInsideMap(nextX, nextY, mapWidth, mapHeight)) {
      continue;
    }
    neighbors.push({ x: nextX, y: nextY });
  }
  return neighbors;
};

const resolveTileHeuristic = (left: GridTile, right: GridTile): number =>
  Math.abs(left.x - right.x) + Math.abs(left.y - right.y);

const reconstructPath = (cameFrom: Map<string, string>, currentKey: string): GridTile[] => {
  const path: GridTile[] = [fromTileKey(currentKey)];
  let cursor = currentKey;

  while (cameFrom.has(cursor)) {
    const previousKey = cameFrom.get(cursor);
    if (!previousKey) {
      break;
    }

    path.unshift(fromTileKey(previousKey));
    cursor = previousKey;
  }

  return path;
};

export const findAStarTilePath = (
  start: GridTile,
  goal: GridTile,
  blockedTiles: Set<string>,
  mapWidth: number = DEFAULT_MAP_WIDTH,
  mapHeight: number = DEFAULT_MAP_HEIGHT
): GridTile[] => {
  const startKey = toTileKey(start.x, start.y);
  const goalKey = toTileKey(goal.x, goal.y);

  if (startKey === goalKey) {
    return [start];
  }

  const openSet = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, resolveTileHeuristic(start, goal)]]);

  while (openSet.size > 0) {
    let currentKey: string | null = null;
    let currentScore = Number.POSITIVE_INFINITY;
    for (const candidateKey of openSet) {
      const candidateScore = fScore.get(candidateKey) ?? Number.POSITIVE_INFINITY;
      if (candidateScore < currentScore) {
        currentScore = candidateScore;
        currentKey = candidateKey;
      }
    }

    if (!currentKey) {
      break;
    }

    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, currentKey);
    }

    openSet.delete(currentKey);
    const currentTile = fromTileKey(currentKey);
    const currentCost = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;

    for (const neighbor of getNeighborTiles(currentTile, mapWidth, mapHeight)) {
      const neighborKey = toTileKey(neighbor.x, neighbor.y);
      if (blockedTiles.has(neighborKey) && neighborKey !== goalKey) {
        continue;
      }

      const tentativeCost = currentCost + 1;
      if (tentativeCost >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentativeCost);
      fScore.set(neighborKey, tentativeCost + resolveTileHeuristic(neighbor, goal));
      openSet.add(neighborKey);
    }
  }

  return [];
};

export const resolveNearestWalkableTile = (
  requestedGoal: GridTile,
  blockedTiles: Set<string>,
  startTile: GridTile,
  mapWidth: number = DEFAULT_MAP_WIDTH,
  mapHeight: number = DEFAULT_MAP_HEIGHT
): GridTile => {
  const goalKey = toTileKey(requestedGoal.x, requestedGoal.y);
  if (!blockedTiles.has(goalKey)) {
    return requestedGoal;
  }

  const startKey = toTileKey(startTile.x, startTile.y);
  if (goalKey === startKey) {
    return requestedGoal;
  }

  const queue: GridTile[] = [requestedGoal];
  const visited = new Set<string>([goalKey]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const neighbor of getNeighborTiles(current, mapWidth, mapHeight)) {
      const neighborKey = toTileKey(neighbor.x, neighbor.y);
      if (visited.has(neighborKey)) {
        continue;
      }

      if (!blockedTiles.has(neighborKey) || neighborKey === startKey) {
        return neighbor;
      }

      visited.add(neighborKey);
      queue.push(neighbor);
    }
  }

  return startTile;
};

export const resolveNearestDecorationTile = (
  requestedTile: GridTile,
  blockedTiles: Set<string>,
  mapWidth: number = DEFAULT_MAP_WIDTH,
  mapHeight: number = DEFAULT_MAP_HEIGHT
): GridTile | null => {
  const origin: GridTile = {
    x: clampToIntRange(requestedTile.x, 0, mapWidth - 1),
    y: clampToIntRange(requestedTile.y, 0, mapHeight - 1),
  };
  const originKey = toTileKey(origin.x, origin.y);

  if (!blockedTiles.has(originKey)) {
    return origin;
  }

  const queue: GridTile[] = [origin];
  const visited = new Set<string>([originKey]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const offset of DECORATION_NEIGHBOR_OFFSETS) {
      const nextX = current.x + offset.x;
      const nextY = current.y + offset.y;
      if (!isTileInsideMap(nextX, nextY, mapWidth, mapHeight)) {
        continue;
      }

      const nextKey = toTileKey(nextX, nextY);
      if (visited.has(nextKey)) {
        continue;
      }

      if (!blockedTiles.has(nextKey)) {
        return { x: nextX, y: nextY };
      }

      visited.add(nextKey);
      queue.push({ x: nextX, y: nextY });
    }
  }

  return null;
};

export const buildRoadPath = (
  from: { x: number; y: number },
  to: { x: number; y: number }
): Array<{ x: number; y: number }> => {
  const path: Array<{ x: number; y: number }> = [];
  let x = from.x;
  let y = from.y;

  path.push({ x, y });
  while (x !== to.x) {
    x += x < to.x ? 1 : -1;
    path.push({ x, y });
  }

  while (y !== to.y) {
    y += y < to.y ? 1 : -1;
    path.push({ x, y });
  }

  return path;
};
