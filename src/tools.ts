import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PublerClient } from "./publerClient.js";
import {
  accountAnalyticsSchema,
  bestTimesSchema,
  campaignContextSchema,
  campaignPlannerSchema,
  createPhotoDraftSchema,
  deletePostSchema,
  draftPostSchema,
  jobStatusSchema,
  listPostsSchema,
  postInsightsSchema,
  publishPhotoNowSchema,
  saveIdeasSchema,
  schedulePhotoPostSchema,
  schedulePostSchema,
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
    name: "publer_save_ideas",
    description: "Save short text notes to the user's own Publer Ideas panel. These are private notes inside Publer — they are NOT posted to any social network, NOT scheduled, and NOT shared with anyone outside the user's Publer workspace. Equivalent to writing to a personal scratchpad inside Publer.",
    inputSchema: jsonSchema(saveIdeasSchema),
    annotations: {
      title: "Save notes to Publer Ideas",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    _meta: invocationMeta("Saving notes to your Publer Ideas", "Notes saved to your Publer Ideas")
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
        case "publer_save_ideas": {
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
