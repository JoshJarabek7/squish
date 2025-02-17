import { z } from "zod";

export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  scale: z.number(),
  opacity: z.number(),
  blendMode: z.string(),
});

export type Transform = z.infer<typeof TransformSchema>;

// Asset schemas for reusable content
export const ImageAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.literal('image'),
  mimeType: z.string(),
  // The actual blob is stored in the database, this is just the type
  createdAt: z.date(),
});

export const StickerAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.literal('sticker'),
  sourceImageId: z.string(), // Reference to the original image
  // The actual transparent PNG blob is stored in the database
  createdAt: z.date(),
});

export const BaseLayerSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  transform: TransformSchema,
  createdAt: z.date(),
});

export const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  color: z.string(),
  backgroundColor: z.string().optional(),
  textAlign: z.enum(['left', 'center', 'right']),
  italic: z.boolean(),
  underline: z.boolean(),
  verticalAlign: z.enum(['top', 'center', 'bottom']),
  wordWrap: z.enum(['normal', 'break-word']),
  stroke: z.object({
    width: z.number(),
    color: z.string(),
    enabled: z.boolean(),
  }).optional(),
});

export const TextLayerSchema = BaseLayerSchema.extend({
  type: z.literal('text'),
  content: z.string(),
  style: TextStyleSchema,
});

export const ImageLayerSchema = BaseLayerSchema.extend({
  type: z.literal('image'),
  imageAssetId: z.string(),
  crop: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
});

export const StickerLayerSchema = BaseLayerSchema.extend({
  type: z.literal('sticker'),
  stickerAssetId: z.string(),
});

export const LayerSchema = z.discriminatedUnion('type', [
  TextLayerSchema,
  ImageLayerSchema,
  StickerLayerSchema,
]);

// Action schemas for undo/redo
export const ActionTypeSchema = z.enum([
  'add_layer',
  'remove_layer',
  'update_transform',
  'update_style',
  'update_content',
  'reorder_layers',
]);

export const ActionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string(),
  type: ActionTypeSchema,
  layerId: z.string(),
  before: z.unknown(), // State before the action
  after: z.unknown(), // State after the action
  timestamp: z.date(),
});

// Project schema with layers and actions
export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  layers: z.array(z.object({
    id: z.string(), // Reference to layer
    index: z.number(), // Layer stack index
  })),
  currentActionIndex: z.number().default(-1), // For undo/redo
  createdAt: z.date(),
});

// Export types
export type ImageAsset = z.infer<typeof ImageAssetSchema>;
export type StickerAsset = z.infer<typeof StickerAssetSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type ImageLayer = z.infer<typeof ImageLayerSchema>;
export type StickerLayer = z.infer<typeof StickerLayerSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Project = z.infer<typeof ProjectSchema>;

// Helper types for creation
export const ProjectCreateSchema = ProjectSchema.pick({
  id: true,
  name: true,
});

export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

export const LayerCreateSchema = z.discriminatedUnion('type', [
  ImageLayerSchema.omit({ createdAt: true }),
  StickerLayerSchema.omit({ createdAt: true }),
  TextLayerSchema.omit({ createdAt: true }),
]);

export type LayerCreate = z.infer<typeof LayerCreateSchema>;