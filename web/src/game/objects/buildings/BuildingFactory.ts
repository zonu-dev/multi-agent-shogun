import Phaser from 'phaser';
import type { BuildingLevel, BuildingType, Position } from '../../../types/game';
import { Building } from './Building';
import {
  BUILDING_CONFIGS,
  BUILDING_TYPE_ORDER,
  clampBuildingLevel,
  normalizeBuildingTilePlacements,
  type BuildingTilePlacement,
} from './BuildingConfig';

export interface BuildingPreset {
  type: BuildingType;
  level: BuildingLevel;
  position: Position;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isBuildingType = (value: unknown): value is BuildingType =>
  typeof value === 'string' && BUILDING_TYPE_ORDER.includes(value as BuildingType);

export const DEFAULT_BUILDING_PRESETS: Record<BuildingType, Omit<BuildingPreset, 'type'>> = {
  castle: {
    level: BUILDING_CONFIGS.castle.defaultLevel,
    position: BUILDING_CONFIGS.castle.defaultPosition,
  },
  mansion: {
    level: BUILDING_CONFIGS.mansion.defaultLevel,
    position: BUILDING_CONFIGS.mansion.defaultPosition,
  },
  inn: {
    level: BUILDING_CONFIGS.inn.defaultLevel,
    position: BUILDING_CONFIGS.inn.defaultPosition,
  },
  dojo: {
    level: BUILDING_CONFIGS.dojo.defaultLevel,
    position: BUILDING_CONFIGS.dojo.defaultPosition,
  },
  smithy: {
    level: BUILDING_CONFIGS.smithy.defaultLevel,
    position: BUILDING_CONFIGS.smithy.defaultPosition,
  },
  training: {
    level: BUILDING_CONFIGS.training.defaultLevel,
    position: BUILDING_CONFIGS.training.defaultPosition,
  },
  study: {
    level: BUILDING_CONFIGS.study.defaultLevel,
    position: BUILDING_CONFIGS.study.defaultPosition,
  },
  healer: {
    level: BUILDING_CONFIGS.healer.defaultLevel,
    position: BUILDING_CONFIGS.healer.defaultPosition,
  },
  watchtower: {
    level: BUILDING_CONFIGS.watchtower.defaultLevel,
    position: BUILDING_CONFIGS.watchtower.defaultPosition,
  },
  scriptorium: {
    level: BUILDING_CONFIGS.scriptorium.defaultLevel,
    position: BUILDING_CONFIGS.scriptorium.defaultPosition,
  },
};

export const createBuilding = (
  scene: Phaser.Scene,
  type: BuildingType,
  level: BuildingLevel,
  position: Position
): Building => new Building(scene, type, clampBuildingLevel(level), position);

export const createDefaultBuilding = (
  scene: Phaser.Scene,
  type: BuildingType,
  overrides?: Partial<Omit<BuildingPreset, 'type'>>
): Building => {
  const preset = DEFAULT_BUILDING_PRESETS[type];

  return createBuilding(
    scene,
    type,
    overrides?.level ?? preset.level,
    overrides?.position ?? { ...preset.position }
  );
};

export const createDefaultBuildings = (scene: Phaser.Scene): Building[] => {
  const buildingTypes = Object.keys(DEFAULT_BUILDING_PRESETS) as BuildingType[];

  return buildingTypes.map((type) => {
    const preset = DEFAULT_BUILDING_PRESETS[type];

    return createBuilding(scene, type, preset.level, { ...preset.position });
  });
};

export const resolveValidatedBuildingPlacements = (
  rawBuildings: unknown
): BuildingTilePlacement[] => {
  const requestedByType: Partial<Record<BuildingType, Position>> = {};

  if (Array.isArray(rawBuildings)) {
    for (const rawBuilding of rawBuildings) {
      if (!isRecord(rawBuilding) || !isBuildingType(rawBuilding.type)) {
        continue;
      }

      const positionSource = isRecord(rawBuilding.position) ? rawBuilding.position : null;
      const tileX = toFiniteNumber(positionSource?.x);
      const tileY = toFiniteNumber(positionSource?.y);

      if (tileX === null || tileY === null || requestedByType[rawBuilding.type]) {
        continue;
      }

      requestedByType[rawBuilding.type] = {
        x: tileX,
        y: tileY,
      };
    }
  }

  return normalizeBuildingTilePlacements(requestedByType);
};
