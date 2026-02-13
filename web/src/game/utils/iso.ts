export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export interface IsoPoint {
  x: number;
  y: number;
}

export const cartToIso = (cartX: number, cartY: number): IsoPoint => {
  return {
    x: (cartX - cartY) * (TILE_WIDTH / 2),
    y: (cartX + cartY) * (TILE_HEIGHT / 2),
  };
};

export const isoToCart = (isoX: number, isoY: number): IsoPoint => {
  const halfWidth = TILE_WIDTH / 2;
  const halfHeight = TILE_HEIGHT / 2;

  return {
    x: (isoX / halfWidth + isoY / halfHeight) / 2,
    y: (isoY / halfHeight - isoX / halfWidth) / 2,
  };
};

export const tileToScreen = (tileX: number, tileY: number): IsoPoint => {
  return cartToIso(tileX, tileY);
};
