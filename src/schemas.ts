import { z } from "zod";

export const providerSchema = z.enum([
  "facebook",
  "linkedin",
  "instagram",
  "twitter",
  "mastodon",
  "tiktok",
  "youtube",
  "pinterest",
  "google",
  "wordpress",
  "telegram",
  "threads",
  "bluesky"
]);

export const postStateSchema = z.enum([
  "all",
  "scheduled",
  "scheduled_approved",
  "scheduled_pending",
  "scheduled_declined",
  "scheduled_reauth",
  "scheduled_locked",
  "published",
  "published_posted",
  "published_deleted",
  "published_hidden",
  "draft",
  "draft_dated",
  "draft_undated",
  "draft_private",
  "draft_public",
  "failed",
  "recycling",
  "recycling_active",
  "recycling_paused",
  "recycling_expired",
  "recycling_failed",
  "recycling_pending",
  "recycling_declined",
  "recycling_reauth",
  "recycling_locked",
  "recurring"
]);

export const postTypeSchema = z.enum([
  "status",
  "link",
  "photo",
  "gif",
  "video",
  "reel",
  "story",
  "short",
  "poll",
  "document",
  "carousel",
  "article"
]);

export const listPostsSchema = z.object({
  workspaceId: z.string().optional(),
  state: postStateSchema.optional().default("scheduled"),
  accountIds: z.array(z.string()).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  query: z.string().optional(),
  postType: postTypeSchema.optional(),
  page: z.number().int().nonnegative().optional()
});

export const schedulePostSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional(),
  text: z.string().min(1),
  scheduledAt: z.string().min(1)
});

export const draftPostSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional(),
  text: z.string().min(1)
});

export const jobStatusSchema = z.object({
  workspaceId: z.string().optional(),
  jobId: z.string().min(1)
});

export const accountAnalyticsSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  accountType: z.string().optional(),
  chartIds: z.array(z.string()).optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

export const postInsightsSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  from: z.string(),
  to: z.string(),
  query: z.string().optional(),
  postType: postTypeSchema.optional(),
  sortBy: z.string().optional(),
  sortType: z.enum(["ASC", "DESC"]).optional(),
  page: z.number().int().nonnegative().optional()
});

export const bestTimesSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  from: z.string(),
  to: z.string()
});

export const updatePostSchema = z.object({
  workspaceId: z.string().optional(),
  postId: z.string().min(1),
  text: z.string().min(1),
  title: z.string().optional()
});

export const deletePostSchema = z.object({
  workspaceId: z.string().optional(),
  postIds: z.array(z.string().min(1)).min(1)
});

const mediaTypeSchema = z.enum(["photo", "video", "gif"]);

export const chatGptFileRefSchema = z.object({
  download_url: z.string().min(1),
  file_id: z.string().optional(),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
});

export const uploadMediaFromChatGptFileSchema = z.object({
  workspaceId: z.string().optional(),
  file: chatGptFileRefSchema,
  inLibrary: z.boolean().optional().default(true)
});

export const createPhotoDraftSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional(),
  mediaId: z.string().min(1),
  text: z.string().min(1),
  caption: z.string().optional(),
  mediaType: mediaTypeSchema.optional().default("photo")
});

export const schedulePhotoPostSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional(),
  mediaId: z.string().min(1),
  text: z.string().min(1),
  caption: z.string().optional(),
  scheduledAt: z.string().min(1),
  mediaType: mediaTypeSchema.optional().default("photo"),
  confirmSchedule: z.boolean()
});

export const publishPhotoNowSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional(),
  mediaId: z.string().min(1),
  text: z.string().min(1),
  caption: z.string().optional(),
  mediaType: mediaTypeSchema.optional().default("photo"),
  confirm: z.boolean()
});

export const saveIdeasSchema = z.object({
  workspaceId: z.string().optional(),
  ideas: z
    .array(
      z.object({
        text: z.string().min(1),
        visibility: z.enum(["draft_public", "draft_private"]).optional().default("draft_public")
      })
    )
    .min(1)
    .max(20)
});

const campaignActionSchema = z.enum(["draft", "schedule", "schedule_best_time"]);

export const campaignPostItemSchema = z.object({
  text: z.string().min(1),
  action: campaignActionSchema,
  scheduledAt: z.string().optional(),
  bestTimeFrom: z.string().optional(),
  bestTimeTo: z.string().optional(),
  mediaId: z.string().optional(),
  caption: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional()
});

export const smartCampaignSchema = z.object({
  brief: z.string().min(1),
  posts: z.array(campaignPostItemSchema).min(1).max(20),
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional(),
  defaultMediaId: z.string().optional()
});

export const campaignContextSchema = z.object({
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  accountType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

export const campaignPlannerSchema = z.object({
  goal: z.string().min(1),
  platforms: z.array(providerSchema).min(1),
  startDate: z.string(),
  numberOfPosts: z.number().int().min(1).max(20),
  tone: z.string().min(1),
  schedule: z.boolean().optional().default(false),
  workspaceId: z.string().optional(),
  accountId: z.string().optional(),
  provider: providerSchema.optional()
});

export type Provider = z.infer<typeof providerSchema>;
export type ListPostsInput = z.infer<typeof listPostsSchema>;
export type SchedulePostInput = z.infer<typeof schedulePostSchema>;
export type DraftPostInput = z.infer<typeof draftPostSchema>;
export type JobStatusInput = z.infer<typeof jobStatusSchema>;
export type AccountAnalyticsInput = z.infer<typeof accountAnalyticsSchema>;
export type PostInsightsInput = z.infer<typeof postInsightsSchema>;
export type BestTimesInput = z.infer<typeof bestTimesSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type DeletePostInput = z.infer<typeof deletePostSchema>;
export type CampaignPlannerInput = z.infer<typeof campaignPlannerSchema>;
export type ChatGptFileRef = z.infer<typeof chatGptFileRefSchema>;
export type UploadMediaFromChatGptFileInput = z.infer<typeof uploadMediaFromChatGptFileSchema>;
export type CampaignPostItem = z.infer<typeof campaignPostItemSchema>;
export type SmartCampaignInput = z.infer<typeof smartCampaignSchema>;
export type CampaignContextInput = z.infer<typeof campaignContextSchema>;
export type SaveIdeasInput = z.infer<typeof saveIdeasSchema>;
export type CreatePhotoDraftInput = z.infer<typeof createPhotoDraftSchema>;
export type SchedulePhotoPostInput = z.infer<typeof schedulePhotoPostSchema>;
export type PublishPhotoNowInput = z.infer<typeof publishPhotoNowSchema>;
