export type ItemType = 'consumable' | 'treasure' | 'material' | 'decoration';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type ItemEffectType =
  | 'town_xp_boost'
  | 'town_gold_boost'
  | 'passive_bonus';

export interface ItemEffect {
  type: ItemEffectType;
  value: number;
  key?: string;
}

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  itemType: ItemType;
  rarity: ItemRarity;
  effect: ItemEffect;
  usable: boolean;
  stackable: boolean;
  shopCost: number;
  purchasable?: boolean;
  upgradeCosts?: number[];
}

export interface InventoryItem {
  itemId: string;
  quantity: number;
}
