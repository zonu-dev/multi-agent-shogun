import Phaser from 'phaser';
import {
  generateBuildingTexture,
  generateCharacterTexture,
  generateGroundTexture,
  generateRoadTexture,
} from '../utils/placeholders';
import { MAIN_SCENE_KEY } from './MainScene';

export const BOOT_SCENE_KEY = 'BootScene';

const BUILDING_TEXTURE_PRESETS = [
  { color: '#D97706', size: 124 },
  { color: '#2563EB', size: 86 },
  { color: '#B45309', size: 82 },
  { color: '#DC2626', size: 90 },
  { color: '#4B5563', size: 90 },
  { color: '#7C3AED', size: 88 },
  { color: '#0EA5E9', size: 84 },
  { color: '#10B981', size: 84 },
  { color: '#E11D48', size: 82 },
];

const CHARACTER_COLORS = [
  '#60A5FA',
  '#34D399',
  '#F472B6',
  '#F59E0B',
  '#A78BFA',
  '#38BDF8',
  '#FB7185',
  '#FACC15',
];

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: BOOT_SCENE_KEY });
  }

  preload(): void {
    generateGroundTexture(this);
    generateRoadTexture(this);

    for (const preset of BUILDING_TEXTURE_PRESETS) {
      generateBuildingTexture(this, preset.color, preset.size);
    }

    for (const color of CHARACTER_COLORS) {
      generateCharacterTexture(this, color);
    }
  }

  create(): void {
    this.scene.start(MAIN_SCENE_KEY);
  }
}
