import { z } from "zod";

export const SettingsSchema = z.object({
  localHosted: z.boolean(),
  runpodApiKey: z.string().nullable(),
  runpodInstanceId: z.string().nullable(),
  createdAt: z.date().optional(),
}).refine(
  (data) => {
    if (data.localHosted) {
      return data.runpodApiKey === null && data.runpodInstanceId === null;
    } else {
      return data.runpodApiKey !== null && data.runpodInstanceId !== null;
    }
  },
  {
    message: "Either localHosted must be true with no RunPod settings, or localHosted must be false with both RunPod settings provided"
  }
);

export type Settings = z.infer<typeof SettingsSchema>;

// Helper type for settings updates
export const SettingsUpdateSchema = z.discriminatedUnion("localHosted", [
  z.object({
    localHosted: z.literal(true),
  }),
  z.object({
    localHosted: z.literal(false),
    runpodApiKey: z.string().min(1),
    runpodInstanceId: z.string().min(1),
  }),
]);

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;