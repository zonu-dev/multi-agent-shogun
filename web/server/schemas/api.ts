import { z } from 'zod';

const nonEmptyTrimmedString = z.string().trim().min(1);
const nonNegativeFiniteNumber = z.number().finite().min(0);
const buildingTypeSchema = z.enum([
  'castle',
  'mansion',
  'inn',
  'dojo',
  'smithy',
  'training',
  'study',
  'healer',
  'watchtower',
  'scriptorium',
]);
const buildingLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const materialDropNoticeItemSchema = z
  .object({
    itemId: nonEmptyTrimmedString,
    quantity: z.number().int().min(1),
    name: z.string().trim().min(1).optional(),
  })
  .passthrough();

const materialDropNoticeSchema = z
  .object({
    workerId: nonEmptyTrimmedString,
    taskId: nonEmptyTrimmedString,
    drops: z.array(materialDropNoticeItemSchema),
    timestamp: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1),
    buildingType: buildingTypeSchema.optional(),
    buildingLevel: buildingLevelSchema.optional(),
    message: z.string().trim().min(1).optional(),
  })
  .passthrough();

const normalizedBuyQuantity = z
  .preprocess((value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(1, Math.min(99, Math.floor(value)));
  }, z.number().int().min(1).max(99).optional())
  .transform((value) => value ?? 1);

export const commandSchema = z
  .object({
    message: nonEmptyTrimmedString,
  })
  .passthrough();

export const approveSchema = z
  .object({
    commandId: z.string().trim().optional(),
    message: z.string().trim().optional(),
  })
  .passthrough();

export const purchaseDecorationSchema = z
  .object({
    decorationId: nonEmptyTrimmedString,
    position: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  })
  .passthrough();

export const collectDecorationSchema = z
  .object({
    decorationId: nonEmptyTrimmedString,
  })
  .passthrough();

export const upgradeDecorationSchema = z
  .object({
    decorationId: nonEmptyTrimmedString,
  })
  .passthrough();

export const moveDecorationSchema = z
  .object({
    decorationId: nonEmptyTrimmedString,
    position: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  })
  .passthrough();

export const moveBuildingSchema = z
  .object({
    buildingId: nonEmptyTrimmedString,
    position: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  })
  .passthrough();

export const placeDecorationSchema = z
  .object({
    decorationType: nonEmptyTrimmedString,
    position: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  })
  .passthrough();

export const upgradeBuildingSchema = z
  .object({
    buildingId: nonEmptyTrimmedString,
    newLevel: buildingLevelSchema.optional(),
  })
  .passthrough();

export const buyItemSchema = z
  .object({
    itemId: nonEmptyTrimmedString,
    quantity: normalizedBuyQuantity,
  })
  .passthrough();

export const claimRewardSchema = z
  .object({
    missionId: nonEmptyTrimmedString,
  })
  .passthrough();

export const equipTitleSchema = z
  .object({
    titleId: z.string().trim().min(1).nullable(),
  })
  .passthrough();

export const useItemSchema = z
  .object({
    itemId: nonEmptyTrimmedString,
  })
  .passthrough();

export const updateEconomySchema = z
  .object({
    gold: nonNegativeFiniteNumber,
  })
  .passthrough();

export const townPatchSchema = z
  .object({
    xp: nonNegativeFiniteNumber.optional(),
    gold: nonNegativeFiniteNumber.optional(),
  })
  .passthrough()
  .refine(
    (value) => value.xp !== undefined || value.gold !== undefined,
    'Request body must include at least one of: xp, gold.'
  );

const gameStatePatchSchema = z
  .object({
    ashigaru: z.array(z.unknown()).optional(),
    buildings: z.array(z.unknown()).optional(),
    town: z.record(z.string(), z.unknown()).optional(),
    economy: z.record(z.string(), z.unknown()).optional(),
    inventory: z.array(z.unknown()).optional(),
    decorations: z.array(z.unknown()).optional(),
    missions: z.array(z.unknown()).optional(),
    activityLog: z.array(z.unknown()).optional(),
    achievements: z.array(z.unknown()).optional(),
    titles: z.array(z.unknown()).optional(),
    equippedTitle: z.string().nullable().optional(),
    dailyRecords: z.array(z.unknown()).optional(),
    materialCollection: z.array(z.unknown()).optional(),
    lastMaterialDrop: materialDropNoticeSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Request body must include at least one game-state field.'
  );

export const gameStateMutationSchema = z.union([
  gameStatePatchSchema,
  z
    .object({
      state: gameStatePatchSchema,
    })
    .strict(),
]);
