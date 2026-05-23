import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PublerClient } from "./publerClient.js";
import {
  accountAnalyticsSchema,
  autoSchedulePostSchema,
  bestTimesSchema,
  campaignContextSchema,
  campaignPlannerSchema,
  competitorAnalysisSchema,
  createArticlePostSchema,
  createCarouselPostSchema,
  createDocumentPostSchema,
  createGifPostSchema,
  createLinkPostSchema,
  createPhotoDraftSchema,
  createPollPostSchema,
  createRecyclingPostSchema,
  createReelPostSchema,
  createShortPostSchema,
  createStoryPostSchema,
  createVideoPostSchema,
  publishStatusNowSchema,
  deletePostSchema,
  draftPostSchema,
  hashtagAnalysisSchema,
  jobStatusSchema,
  listByStateSchema,
  listMediaSchema,
  listMembersSchema,
  listPostsSchema,
  postInsightsSchema,
  publishPhotoNowSchema,
  recurringPostSchema,
  saveIdeasSchema,
  schedulePhotoPostSchema,
  schedulePostSchema,
  searchPostsSchema,
  smartCampaignSchema,
  updatePostSchema,
  uploadMediaFromChatGptFileSchema
} from "./schemas.js";

type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  title?: string;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

function invocationMeta(invoking: string, invoked: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    ...extra
  };
}

function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const shape = schema instanceof z.ZodObject ? schema.shape : {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as z.ZodTypeAny;
    const isOptional = zodType.isOptional() || zodType instanceof z.ZodDefault;
    const unwrapped = zodType instanceof z.ZodDefault ? zodType.removeDefault() : zodType;
    properties[key] = zodToJsonSchema(unwrapped);
    if (!isOptional) required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return zodToJsonSchema(schema.removeDefault());
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodObject) return jsonSchema(schema);
  return {};
}

function toolResult(summary: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ summary, data }, null, 2)
      }
    ]
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const extra =
    typeof error === "object" && error !== null && "body" in error
      ? { body: (error as { body: unknown }).body }
      : undefined;

  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ summary: message, ...extra }, null, 2)
      }
    ]
  };
}

const tools: ToolDefinition[] = [
  {
    name: "publer_get_current_user",
    description: "Return the profile of the user whose API key is in use (id, name, email, picture). Read-only.",
    inputSchema: jsonSchema(z.object({})),
    annotations: {
      title: "Get current Publer user",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_list_workspaces",
    description: "List Publer workspaces available to the authenticated API key.",
    inputSchema: jsonSchema(z.object({}))
  },
  {
    name: "publer_list_accounts",
    description: "List social media accounts connected to the selected Publer workspace.",
    inputSchema: jsonSchema(z.object({ workspaceId: z.string().optional() }))
  },
  {
    name: "publer_list_posts",
    description: "List Publer posts with optional state, account, date, query, and post type filters.",
    inputSchema: jsonSchema(listPostsSchema)
  },
  {
    name: "publer_list_drafts",
    description: "List the user's Publer drafts (convenience wrapper around publer_list_posts with state=draft). Filter by account, date range, post type, page.",
    inputSchema: jsonSchema(listByStateSchema),
    annotations: {
      title: "List Publer drafts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_list_published_posts",
    description: "List the user's already-published Publer posts (convenience wrapper around publer_list_posts with state=published). Filter by account, date range, post type, page.",
    inputSchema: jsonSchema(listByStateSchema),
    annotations: {
      title: "List Publer published posts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_list_failed_posts",
    description: "List the user's Publer posts that failed to publish (convenience wrapper around publer_list_posts with state=failed). Useful for debugging delivery issues.",
    inputSchema: jsonSchema(listByStateSchema),
    annotations: {
      title: "List Publer failed posts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_search_posts",
    description: "Full-text search the user's Publer posts by keyword. Optional state filter (defaults to all states), date range, page.",
    inputSchema: jsonSchema(searchPostsSchema),
    annotations: {
      title: "Search Publer posts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_auto_schedule_post",
    description: "Auto-schedule a text post into one of the user's own Publer posting-schedule slots between startDate and optional endDate. Requires the user to have a Publer posting schedule already configured on that account. Polls the job until done. The post is queued in Publer and will only be published by Publer's scheduler at the chosen time.",
    inputSchema: jsonSchema(autoSchedulePostSchema),
    annotations: {
      title: "Auto-schedule Publer post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Auto-scheduling post in Publer", "Post auto-scheduled in Publer")
  },
  {
    name: "publer_create_recurring_post",
    description: "Create a recurring text post in the user's own Publer workspace (daily, weekly, or monthly cadence). repeat=weekly requires daysOfWeek (1=Mon ... 7=Sun). repeatRate controls every-N (e.g. repeat=weekly + repeatRate=2 means every other week). The post repeats on Publer's scheduler until endDate; nothing is published outside this schedule.",
    inputSchema: jsonSchema(recurringPostSchema),
    annotations: {
      title: "Create recurring Publer post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Setting up recurring post in Publer", "Recurring post set up in Publer")
  },
  {
    name: "publer_create_draft",
    description: "Create a draft post in Publer without publishing it. The draft is saved to the user's Publer workspace and is not published to any social network.",
    inputSchema: jsonSchema(draftPostSchema),
    annotations: {
      title: "Save Publer draft",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Saving draft to Publer", "Draft saved to Publer")
  },
  {
    name: "publer_schedule_post",
    description: "Schedule a text/status post in the user's Publer account. scheduledAt must be ISO 8601 and at least 1 minute in the future. Polls job status before returning. The post is queued in Publer and will only be published by Publer's scheduler at the requested time.",
    inputSchema: jsonSchema(schedulePostSchema),
    annotations: {
      title: "Schedule Publer post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Scheduling post in Publer", "Post scheduled in Publer")
  },
  {
    name: "publer_get_job_status",
    description: "Check the status of an asynchronous Publer job.",
    inputSchema: jsonSchema(jobStatusSchema)
  },
  {
    name: "publer_get_account_analytics",
    description: "Fetch available analytics charts or chart data for a Publer social account.",
    inputSchema: jsonSchema(accountAnalyticsSchema)
  },
  {
    name: "publer_get_post_insights",
    description: "Fetch post-level analytics for published posts in a Publer account.",
    inputSchema: jsonSchema(postInsightsSchema)
  },
  {
    name: "publer_get_best_times",
    description: "Fetch best times to post heatmap data for a Publer social account.",
    inputSchema: jsonSchema(bestTimesSchema)
  },
  {
    name: "publer_update_post",
    description: "Update the text and optional title of an existing Publer post.",
    inputSchema: jsonSchema(updatePostSchema),
    annotations: {
      title: "Update Publer post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: invocationMeta("Updating Publer post", "Publer post updated")
  },
  {
    name: "publer_delete_posts",
    description: "Delete one or more Publer posts by post ID.",
    inputSchema: jsonSchema(deletePostSchema),
    annotations: {
      title: "Delete Publer posts",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: invocationMeta("Deleting Publer posts", "Publer posts deleted")
  },
  {
    name: "publer_plan_campaign",
    description: "Plan a campaign and optionally schedule it to one selected Publer account.",
    inputSchema: jsonSchema(campaignPlannerSchema)
  },
  {
    name: "publer_list_media",
    description: "List items in the user's own Publer media library with optional filters (ids, types, used, source, search, page). Read-only.",
    inputSchema: jsonSchema(listMediaSchema),
    annotations: {
      title: "List Publer media library",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_list_workspace_members",
    description: "List the members of the user's selected Publer workspace. Read-only.",
    inputSchema: jsonSchema(listMembersSchema),
    annotations: {
      title: "List Publer workspace members",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_get_hashtag_analysis",
    description: "Fetch hashtag-performance analytics for a Publer social account in a date range. Read-only.",
    inputSchema: jsonSchema(hashtagAnalysisSchema),
    annotations: {
      title: "Get Publer hashtag analytics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_get_competitor_analysis",
    description: "Fetch competitor benchmarking analytics for a Publer social account in a date range. Optional competitorIds filter. Read-only.",
    inputSchema: jsonSchema(competitorAnalysisSchema),
    annotations: {
      title: "Get Publer competitor analytics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "publer_create_link_post",
    description: "Create a link post in the user's Publer workspace (network type=link) with a URL and optional preview overrides (title, description, image). If scheduledAt is omitted the post is saved as a workspace draft; if provided it is scheduled in Publer at that ISO 8601 timestamp.",
    inputSchema: jsonSchema(createLinkPostSchema),
    annotations: {
      title: "Create Publer link post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating link post in Publer", "Link post created in Publer")
  },
  {
    name: "publer_create_poll_post",
    description: "Create a poll post (network type=poll) with 2-4 options and an optional duration in days (default 1). If scheduledAt is omitted, saved as a workspace draft; otherwise scheduled at the ISO 8601 timestamp.",
    inputSchema: jsonSchema(createPollPostSchema),
    annotations: {
      title: "Create Publer poll post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating poll post in Publer", "Poll post created in Publer")
  },
  {
    name: "publer_create_recycling_post",
    description: "Create a recycling (evergreen) post that Publer reposts on a cadence between startDate and an optional expireDate/expireCount. gap + gapFreq controls the cadence (e.g. gap=2 gapFreq=Week = every 2 weeks). The post is queued in Publer's recycler; nothing is published outside that schedule.",
    inputSchema: jsonSchema(createRecyclingPostSchema),
    annotations: {
      title: "Create Publer recycling post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Setting up recycling post in Publer", "Recycling post set up in Publer")
  },
  {
    name: "publer_create_video_post",
    description: "Create a video post (network type=video) in the user's Publer workspace using an existing video mediaId from the library (publer_list_media). If scheduledAt omitted → workspace draft; otherwise scheduled.",
    inputSchema: jsonSchema(createVideoPostSchema),
    annotations: {
      title: "Create Publer video post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating video post in Publer", "Video post created in Publer")
  },
  {
    name: "publer_create_carousel_post",
    description: "Create a carousel post (network type=carousel) from 2-10 existing photo mediaIds in the user's Publer library. If scheduledAt omitted → workspace draft; otherwise scheduled at that time.",
    inputSchema: jsonSchema(createCarouselPostSchema),
    annotations: {
      title: "Create Publer carousel post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating carousel post in Publer", "Carousel post created in Publer")
  },
  {
    name: "publer_create_reel_post",
    description: "Create a reel (network type=reel) from an existing video mediaId in the user's Publer library. Use for Instagram/Facebook Reels. If scheduledAt omitted → workspace draft; otherwise scheduled.",
    inputSchema: jsonSchema(createReelPostSchema),
    annotations: {
      title: "Create Publer reel",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating reel in Publer", "Reel created in Publer")
  },
  {
    name: "publer_create_gif_post",
    description: "Create a GIF post (network type=gif) using an existing gif mediaId from the user's Publer library. If scheduledAt omitted → workspace draft; otherwise scheduled.",
    inputSchema: jsonSchema(createGifPostSchema),
    annotations: {
      title: "Create Publer GIF post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating GIF post in Publer", "GIF post created in Publer")
  },
  {
    name: "publer_create_short_post",
    description: "Create a YouTube Short (network type=short) from an existing video mediaId in the user's Publer library. Optional title. If scheduledAt omitted → workspace draft; otherwise scheduled.",
    inputSchema: jsonSchema(createShortPostSchema),
    annotations: {
      title: "Create YouTube Short via Publer",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating YouTube Short in Publer", "Short created in Publer")
  },
  {
    name: "publer_create_document_post",
    description: "Create a document post (network type=document) from an existing document mediaId in the user's Publer library. Typical use: LinkedIn document posts (PDFs/slides). Optional title. If scheduledAt omitted → workspace draft; otherwise scheduled.",
    inputSchema: jsonSchema(createDocumentPostSchema),
    annotations: {
      title: "Create Publer document post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating document post in Publer", "Document post created in Publer")
  },
  {
    name: "publer_create_article_post",
    description: "Create a long-form article post (network type=article) in the user's Publer workspace. Typical use: WordPress blog posts. Requires title + body. Optional featured-image mediaId. If scheduledAt omitted → workspace draft; otherwise scheduled.",
    inputSchema: jsonSchema(createArticlePostSchema),
    annotations: {
      title: "Create Publer article post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating article in Publer", "Article created in Publer")
  },
  {
    name: "publer_publish_status_now",
    description: "Publish a text/status post live immediately on the user's connected Publer account. Requires confirm=true because this sends the post live. For text-only posts; use publer_publish_photo_now for photos.",
    inputSchema: jsonSchema(publishStatusNowSchema),
    annotations: {
      title: "Publish Publer status now",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Publishing status post live via Publer", "Status post published via Publer")
  },
  {
    name: "publer_create_story_post",
    description: "Create a story (network type=story) from an existing photo/video mediaId in the user's Publer library. For Instagram/Facebook Stories. If scheduledAt omitted → workspace draft; otherwise scheduled.",
    inputSchema: jsonSchema(createStoryPostSchema),
    annotations: {
      title: "Create Publer story",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Creating story in Publer", "Story created in Publer")
  },
  {
    name: "publer_save_workspace_drafts",
    description: "Save short text notes as workspace-visible drafts in the user's own Publer workspace (uses state=draft_public with networks.default and no account binding). These appear in the user's Publer Drafts panel — they are NOT posted to any social network, NOT scheduled, and NOT shared outside the workspace. Equivalent to a brainstorm scratchpad living inside Publer. Use `visibility: draft_private` if the note should only be visible to the creator.",
    inputSchema: jsonSchema(saveIdeasSchema),
    annotations: {
      title: "Save brainstorm drafts to Publer",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Saving brainstorm drafts to Publer", "Brainstorm drafts saved in Publer")
  },
  {
    name: "publer_get_campaign_context",
    description: "One-shot fetch for campaign planning: returns the user's Publer accounts, currently scheduled posts (preview), analytics chart availability, and the top-ranked best-times slots in the requested window. Use this BEFORE calling publer_smart_campaign so the LLM can plan with grounded data instead of guessing accounts or time slots.",
    inputSchema: jsonSchema(campaignContextSchema),
    annotations: {
      title: "Get Publer campaign context",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: invocationMeta("Pulling Publer campaign context", "Got Publer campaign context")
  },
  {
    name: "publer_batch_schedule_posts",
    description: "Batch-create drafts and scheduled posts in the user's own Publer workspace. This tool ONLY creates drafts (saved in Publer, not published) and scheduled posts (queued in Publer's scheduler for a future time). It does NOT publish anything live. To publish live, the caller must use publer_publish_photo_now separately, item by item. Each item declares action='draft', action='schedule' with scheduledAt, or action='schedule_best_time' with a date window (server picks the highest-scoring slot from Publer's best-times heatmap and dedupes across items). Items can share a defaultMediaId. Returns a per-item status report.",
    inputSchema: jsonSchema(smartCampaignSchema),
    annotations: {
      title: "Batch-schedule Publer posts",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Batch-scheduling posts in Publer", "Batch scheduled posts in Publer")
  },
  {
    name: "publer_upload_media_from_chatgpt_file",
    description: "Upload a user-attached file to the user's own Publer media library. The file is saved only to the Publer media library and is not published anywhere. Pass the attached file in the `file` argument; ChatGPT will inject the file reference object ({ download_url, file_id, mime_type, file_name }). Returns the Publer mediaId for use with publer_create_photo_draft, publer_schedule_photo_post, or publer_publish_photo_now.",
    inputSchema: jsonSchema(uploadMediaFromChatGptFileSchema),
    annotations: {
      title: "Upload media to Publer library",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta(
      "Uploading file to your Publer media library",
      "File added to Publer media library",
      { "openai/fileParams": ["file"] }
    )
  },
  {
    name: "publer_create_photo_draft",
    description: "Create a photo draft in the user's own Publer workspace from an existing Publer mediaId. The draft is saved inside Publer and is not published to any social network.",
    inputSchema: jsonSchema(createPhotoDraftSchema),
    annotations: {
      title: "Save Publer photo draft",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Saving photo draft in Publer", "Photo draft saved in Publer")
  },
  {
    name: "publer_schedule_photo_post",
    description: "Schedule a photo post in the user's own Publer workspace using a Publer mediaId. scheduledAt must be ISO 8601 at least 1 minute in the future. The post is queued in Publer and will only be published by Publer's scheduler at the requested time. Requires confirmSchedule=true.",
    inputSchema: jsonSchema(schedulePhotoPostSchema),
    annotations: {
      title: "Schedule Publer photo post",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Scheduling photo post in Publer", "Photo post scheduled in Publer")
  },
  {
    name: "publer_publish_photo_now",
    description: "Publish a photo post immediately using a Publer mediaId. This sends the post live through the user's connected Publer accounts. Requires confirm=true because this publishes live content.",
    inputSchema: jsonSchema(publishPhotoNowSchema),
    annotations: {
      title: "Publish Publer photo now",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Publishing photo to your social accounts via Publer", "Photo published via Publer")
  }
];

function planCampaign(input: z.infer<typeof campaignPlannerSchema>) {
  const start = new Date(input.startDate);
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;

  return Array.from({ length: input.numberOfPosts }, (_, index) => {
    const scheduledAt = new Date(safeStart);
    scheduledAt.setDate(safeStart.getDate() + index * 2);
    scheduledAt.setHours(index % 2 === 0 ? 10 : 15, 0, 0, 0);

    const platformList = input.platforms.join(", ");
    return {
      platform_targets: input.platforms,
      scheduledAt: scheduledAt.toISOString(),
      text: `${input.goal} (${index + 1}/${input.numberOfPosts})\n\n${campaignAngle(index, input.tone, platformList)}`
    };
  });
}

function campaignAngle(index: number, tone: string, platforms: string): string {
  const angles = [
    `Announce the value clearly in a ${tone} tone for ${platforms}.`,
    `Share a practical tip connected to the campaign goal in a ${tone} tone.`,
    `Tell a short proof point or customer-style outcome in a ${tone} tone.`,
    `Ask an engagement question that points back to the campaign goal in a ${tone} tone.`,
    `Close with a concise call to action in a ${tone} tone.`
  ];

  return angles[index % angles.length];
}

export function registerPublerTools(server: Server, client = new PublerClient()): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments ?? {};

      switch (request.params.name) {
        case "publer_get_current_user": {
          const result = await client.getCurrentUser();
          return toolResult(result.summary, result.data);
        }
        case "publer_list_workspaces": {
          const result = await client.listWorkspaces();
          return toolResult(result.summary, result.data);
        }
        case "publer_list_accounts": {
          const parsed = z.object({ workspaceId: z.string().optional() }).parse(args);
          const result = await client.listAccounts(parsed.workspaceId);
          return toolResult(result.summary, result.data);
        }
        case "publer_list_posts": {
          const result = await client.listPosts(listPostsSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_list_drafts": {
          const result = await client.listDrafts(listByStateSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_list_published_posts": {
          const result = await client.listPublishedPosts(listByStateSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_list_failed_posts": {
          const result = await client.listFailedPosts(listByStateSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_search_posts": {
          const result = await client.searchPosts(searchPostsSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_auto_schedule_post": {
          const result = await client.autoSchedulePost(autoSchedulePostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_recurring_post": {
          const result = await client.createRecurringPost(recurringPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_draft": {
          const result = await client.createDraft(draftPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_schedule_post": {
          const result = await client.schedulePostAndWait(schedulePostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_get_job_status": {
          const result = await client.getJobStatus(jobStatusSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_get_account_analytics": {
          const result = await client.getAccountAnalytics(accountAnalyticsSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_get_post_insights": {
          const result = await client.getPostInsights(postInsightsSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_get_best_times": {
          const result = await client.getBestTimes(bestTimesSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_update_post": {
          const result = await client.updatePost(updatePostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_delete_posts": {
          const result = await client.deletePosts(deletePostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_list_media": {
          const result = await client.listMedia(listMediaSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_list_workspace_members": {
          const result = await client.listWorkspaceMembers(listMembersSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_get_hashtag_analysis": {
          const result = await client.getHashtagAnalysis(hashtagAnalysisSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_get_competitor_analysis": {
          const result = await client.getCompetitorAnalysis(competitorAnalysisSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_link_post": {
          const result = await client.createLinkPost(createLinkPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_poll_post": {
          const result = await client.createPollPost(createPollPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_recycling_post": {
          const result = await client.createRecyclingPost(createRecyclingPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_video_post": {
          const result = await client.createVideoPost(createVideoPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_carousel_post": {
          const result = await client.createCarouselPost(createCarouselPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_reel_post": {
          const result = await client.createReelPost(createReelPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_story_post": {
          const result = await client.createStoryPost(createStoryPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_gif_post": {
          const result = await client.createGifPost(createGifPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_short_post": {
          const result = await client.createShortPost(createShortPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_document_post": {
          const result = await client.createDocumentPost(createDocumentPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_article_post": {
          const result = await client.createArticlePost(createArticlePostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_publish_status_now": {
          const result = await client.publishStatusNow(publishStatusNowSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_save_workspace_drafts": {
          const result = await client.saveIdeas(saveIdeasSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_get_campaign_context": {
          const result = await client.getCampaignContext(campaignContextSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_batch_schedule_posts": {
          const result = await client.runSmartCampaign(smartCampaignSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_upload_media_from_chatgpt_file": {
          const result = await client.uploadMediaFromChatGptFile(uploadMediaFromChatGptFileSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_create_photo_draft": {
          const result = await client.createPhotoDraftFromMedia(createPhotoDraftSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_schedule_photo_post": {
          const result = await client.schedulePhotoFromMedia(schedulePhotoPostSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_publish_photo_now": {
          const result = await client.publishPhotoNow(publishPhotoNowSchema.parse(args));
          return toolResult(result.summary, result.data);
        }
        case "publer_plan_campaign": {
          const parsed = campaignPlannerSchema.parse(args);
          const posts = planCampaign(parsed);

          if (!parsed.schedule) {
            return toolResult(`Planned ${posts.length} campaign posts.`, { posts });
          }

          const scheduled = [];
          for (const post of posts) {
            const result = await client.schedulePostAndWait({
              workspaceId: parsed.workspaceId,
              accountId: parsed.accountId,
              provider: parsed.provider ?? parsed.platforms[0],
              text: post.text,
              scheduledAt: post.scheduledAt
            });
            scheduled.push(result.data);
          }

          return toolResult(`Planned and scheduled ${scheduled.length} campaign posts.`, { posts, scheduled });
        }
        default:
          return errorResult(new Error(`Unknown tool: ${request.params.name}`));
      }
    } catch (error) {
      return errorResult(error);
    }
  });
}
