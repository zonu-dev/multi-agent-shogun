import Phaser from 'phaser';

export type CharacterVisualState =
  | 'idle'
  | 'assigned'
  | 'working'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'offline';

export interface RankVisualProfile {
  scale: number;
  auraAlpha: number;
  strokeWidth: number;
}

export interface AshigaruProfile {
  id: string;
  index: number;
  name: string;
  baseColor: number;
  accentColor: number;
}

export const ASHIGARU_PROFILES: AshigaruProfile[] = [
  {
    id: 'ashigaru1',
    index: 1,
    name: '足軽壱',
    baseColor: 0x4e79a7,
    accentColor: 0xcfe8ff,
  },
  {
    id: 'ashigaru2',
    index: 2,
    name: '足軽弐',
    baseColor: 0xf28e2b,
    accentColor: 0xffd8ae,
  },
  {
    id: 'ashigaru3',
    index: 3,
    name: '足軽参',
    baseColor: 0xe15759,
    accentColor: 0xffc2c3,
  },
  {
    id: 'ashigaru4',
    index: 4,
    name: '足軽肆',
    baseColor: 0x76b7b2,
    accentColor: 0xcaefeb,
  },
  {
    id: 'ashigaru5',
    index: 5,
    name: '足軽伍',
    baseColor: 0x59a14f,
    accentColor: 0xc8e7c5,
  },
  {
    id: 'ashigaru6',
    index: 6,
    name: '足軽陸',
    baseColor: 0xedc948,
    accentColor: 0xffefae,
  },
  {
    id: 'ashigaru7',
    index: 7,
    name: '足軽漆',
    baseColor: 0xb07aa1,
    accentColor: 0xe8d1e0,
  },
  {
    id: 'ashigaru8',
    index: 8,
    name: '足軽捌',
    baseColor: 0xff9da7,
    accentColor: 0xffd7dd,
  },
];

const DEFAULT_PROFILE: AshigaruProfile = {
  id: 'ashigaru0',
  index: 0,
  name: '足軽',
  baseColor: 0x8f8f8f,
  accentColor: 0xe0e0e0,
};

export const RANK_VISUALS: Record<number, RankVisualProfile> = {
  1: { scale: 1, auraAlpha: 0.12, strokeWidth: 2 },
  2: { scale: 1.04, auraAlpha: 0.18, strokeWidth: 2.5 },
  3: { scale: 1.08, auraAlpha: 0.22, strokeWidth: 3 },
  4: { scale: 1.12, auraAlpha: 0.26, strokeWidth: 3.5 },
  5: { scale: 1.16, auraAlpha: 0.3, strokeWidth: 4 },
};

export function getAshigaruProfile(id: string): AshigaruProfile {
  return ASHIGARU_PROFILES.find((profile) => profile.id === id) ?? DEFAULT_PROFILE;
}

export function getRankVisual(rank: number): RankVisualProfile {
  const boundedRank = Phaser.Math.Clamp(Math.floor(rank), 1, 5);
  return RANK_VISUALS[boundedRank] ?? RANK_VISUALS[1];
}

export function getStatusColor(baseColor: number, status: CharacterVisualState): number {
  const color = Phaser.Display.Color.IntegerToColor(baseColor);
  const white = Phaser.Display.Color.ValueToColor(0xffffff);
  const red = Phaser.Display.Color.ValueToColor(0xff5252);
  const blue = Phaser.Display.Color.ValueToColor(0x52a7ff);

  switch (status) {
    case 'idle':
      return Phaser.Display.Color.Interpolate.ColorWithColor(color, white, 100, 10).color;
    case 'assigned':
      return Phaser.Display.Color.Interpolate.ColorWithColor(color, blue, 100, 22).color;
    case 'working':
      return Phaser.Display.Color.Interpolate.ColorWithColor(color, white, 100, 26).color;
    case 'done':
      return 0xffde59;
    case 'failed':
    case 'blocked':
      return Phaser.Display.Color.Interpolate.ColorWithColor(color, red, 100, 48).color;
    case 'offline':
      return 0x5f5f5f;
    default:
      return baseColor;
  }
}

export function getStatusRingColor(status: CharacterVisualState): number {
  switch (status) {
    case 'idle':
      return 0xeff6ff;
    case 'assigned':
      return 0x78bfff;
    case 'working':
      return 0xb4f6b5;
    case 'done':
      return 0xfff59d;
    case 'failed':
    case 'blocked':
      return 0xff8a80;
    case 'offline':
      return 0x8d8d8d;
    default:
      return 0xffffff;
  }
}
