import Phaser from 'phaser';
import { TILE_HEIGHT, TILE_WIDTH } from './iso';

export const GROUND_TEXTURE_KEY = 'ground-tile';
export const ROAD_TEXTURE_KEY = 'road-tile';

const colorToNumber = (color: string): number => {
  return Number.parseInt(color.replace('#', ''), 16);
};

const ensureGeneratedTexture = (
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (graphics: Phaser.GameObjects.Graphics) => void
): string => {
  if (scene.textures.exists(key)) {
    return key;
  }

  const graphics = scene.add.graphics({ x: 0, y: 0 });
  draw(graphics);
  graphics.generateTexture(key, width, height);
  graphics.destroy();

  return key;
};

export const generateGroundTexture = (scene: Phaser.Scene): string => {
  return ensureGeneratedTexture(scene, GROUND_TEXTURE_KEY, TILE_WIDTH, TILE_HEIGHT, (graphics) => {
    graphics.fillStyle(colorToNumber('#2F8A4B'), 1);
    graphics.lineStyle(2, colorToNumber('#1D5A34'), 0.9);
    graphics.beginPath();
    graphics.moveTo(TILE_WIDTH / 2, 0);
    graphics.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
    graphics.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
    graphics.lineTo(0, TILE_HEIGHT / 2);
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
  });
};

export const generateRoadTexture = (scene: Phaser.Scene): string => {
  return ensureGeneratedTexture(scene, ROAD_TEXTURE_KEY, TILE_WIDTH, TILE_HEIGHT, (graphics) => {
    graphics.fillStyle(colorToNumber('#8B5E3C'), 1);
    graphics.lineStyle(2, colorToNumber('#5D3A23'), 0.9);
    graphics.beginPath();
    graphics.moveTo(TILE_WIDTH / 2, 0);
    graphics.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
    graphics.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
    graphics.lineTo(0, TILE_HEIGHT / 2);
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
  });
};

export const generateBuildingTexture = (
  scene: Phaser.Scene,
  color: string,
  size: number
): string => {
  const normalizedColor = color.replace('#', '').toLowerCase();
  const key = `building-${normalizedColor}-${size}`;
  const width = size;
  const height = Math.max(48, Math.floor(size * 0.72));

  return ensureGeneratedTexture(scene, key, width, height, (graphics) => {
    const baseColor = colorToNumber(color);
    const roofColor = Phaser.Display.Color.GetColor(
      Math.min(255, ((baseColor >> 16) & 0xff) + 24),
      Math.min(255, ((baseColor >> 8) & 0xff) + 24),
      Math.min(255, (baseColor & 0xff) + 24)
    );

    graphics.fillStyle(baseColor, 1);
    graphics.lineStyle(3, colorToNumber('#1A1A2E'), 0.8);
    graphics.fillRect(
      6,
      Math.floor(height * 0.3),
      width - 12,
      height - Math.floor(height * 0.3) - 6
    );
    graphics.strokeRect(
      6,
      Math.floor(height * 0.3),
      width - 12,
      height - Math.floor(height * 0.3) - 6
    );

    graphics.fillStyle(roofColor, 1);
    graphics.beginPath();
    graphics.moveTo(width / 2, 4);
    graphics.lineTo(width - 4, Math.floor(height * 0.32));
    graphics.lineTo(4, Math.floor(height * 0.32));
    graphics.closePath();
    graphics.fillPath();
  });
};

export const generateCharacterTexture = (scene: Phaser.Scene, color: string): string => {
  const normalizedColor = color.replace('#', '').toLowerCase();
  const key = `character-${normalizedColor}`;
  const diameter = 24;

  return ensureGeneratedTexture(scene, key, diameter, diameter, (graphics) => {
    graphics.fillStyle(colorToNumber(color), 1);
    graphics.lineStyle(2, colorToNumber('#121221'), 0.85);
    graphics.fillCircle(diameter / 2, diameter / 2, diameter / 2 - 2);
    graphics.strokeCircle(diameter / 2, diameter / 2, diameter / 2 - 2);
  });
};
