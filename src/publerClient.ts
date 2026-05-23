    import { config, PUBLER_BASE_URL, requireApiKey, resolveAccountId, resolveWorkspaceId } from "./config.js";
    import type {
      AccountAnalyticsInput,
      BestTimesInput,
      AutoSchedulePostInput,
      CampaignContextInput,
      CampaignPostItem,
      CompetitorAnalysisInput,
      CreateArticlePostInput,
      CreateCarouselPostInput,
      CreateDocumentPostInput,
      CreateGifPostInput,
      CreateLinkPostInput,
      CreatePollPostInput,
      CreateRecyclingPostInput,
      CreateReelPostInput,
      CreateShortPostInput,
      CreateStoryPostInput,
      CreateVideoPostInput,
      PublishStatusNowInput,
      HashtagAnalysisInput,
      ListByStateInput,
      ListMediaInput,
      ListMembersInput,
      RecurringPostInput,
      SaveIdeasInput,
      SearchPostsInput,
      ChatGptFileRef,
      CreatePhotoDraftInput,
      DeletePostInput,
      DraftPostInput,
      JobStatusInput,
      ListPostsInput,
      PostInsightsInput,
      Provider,
      PublishPhotoNowInput,
      SchedulePhotoPostInput,
      SchedulePostInput,
      SmartCampaignInput,
      UpdatePostInput,
      UploadMediaFromChatGptFileInput
    } from "./schemas.js";

    type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
    type QueryValue = string | number | boolean | undefined | null | Array<string | number | boolean>;

    export interface PublerResult<T = unknown> {
      summary: string;
      data: T;
    }

    export class PublerApiError extends Error {
      constructor(
        message: string,
        public readonly status: number,
        public readonly body: unknown
      ) {
        super(message);
      }
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function buildSearchParams(query?: Record<string, QueryValue>): string {
      if (!query) return "";

      const params = new URLSearchParams();

      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;

        if (Array.isArray(value)) {
          for (const item of value) params.append(key.endsWith("[]") ? key : `${key}[]`, String(item));
          continue;
        }

        params.set(key, String(value));
      }

      const serialized = params.toString();
      return serialized ? `?${serialized}` : "";
    }

    function hasFailures(jobStatus: unknown): boolean {
      const payload = typeof jobStatus === "object" && jobStatus !== null ? (jobStatus as { payload?: unknown }).payload : undefined;
      if (!payload || typeof payload !== "object") return false;

      const failures = (payload as { failures?: unknown }).failures;
      if (!failures) return false;
      if (Array.isArray(failures)) return failures.length > 0;
      if (typeof failures === "object") return Object.keys(failures).length > 0;
      return true;
    }

    function getStatus(jobStatus: unknown): string | undefined {
      if (typeof jobStatus !== "object" || jobStatus === null) return undefined;
      const status = (jobStatus as { status?: unknown }).status;
      return typeof status === "string" ? status : undefined;
    }

    function asRecord(value: unknown): Record<string, unknown> | undefined {
      return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
    }

    function extractCollection(data: unknown, key: string): unknown[] {
      if (Array.isArray(data)) return data;
      const record = asRecord(data);
      const nested = record?.[key];
      return Array.isArray(nested) ? nested : [];
    }

    function isLikelyMediaRecord(value: unknown): value is Record<string, unknown> {
      const record = asRecord(value);
      if (!record) return false;
      return typeof record.id === "string" && (record.type !== undefined || record.path !== undefined || record.url !== undefined);
    }

    function findMediaRecord(value: unknown): Record<string, unknown> | undefined {
      if (isLikelyMediaRecord(value)) return value;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findMediaRecord(item);
          if (found) return found;
        }
        return undefined;
      }
      const record = asRecord(value);
      if (!record) return undefined;
      for (const item of Object.values(record)) {
        const found = findMediaRecord(item);
        if (found) return found;
      }
      return undefined;
    }

    function pickMediaSummary(media: Record<string, unknown> | undefined): Record<string, unknown> {
      const record = media ?? {};
      return {
        id: record.id,
        type: record.type,
        name: record.name,
        path: record.path ?? record.url,
        url: record.url,
        thumbnail: record.thumbnail
      };
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    type BestTimeSlot = { day: string; date: string; hour: number; score: number; scheduledAt: string };

    function parseDateOnly(value: string): Date {
      const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
      return date;
    }

    function formatScheduledAt(date: Date, hour: number): string {
      const datePart = date.toISOString().slice(0, 10);
      const hourPart = String(hour).padStart(2, "0");
      return `${datePart}T${hourPart}:00:00Z`;
    }

    function rankedBestTimeSlots(bestTimes: unknown, from: string, to: string): BestTimeSlot[] {
      const heatmap = asRecord(bestTimes);
      if (!heatmap) return [];
      const start = parseDateOnly(from);
      const end = parseDateOnly(to);
      if (start.getTime() > end.getTime()) return [];

      const slots: BestTimeSlot[] = [];
      for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const day = dayNames[cursor.getUTCDay()];
        const scores = Array.isArray(heatmap[day]) ? heatmap[day] : undefined;
        if (!scores) continue;
        for (let hour = 0; hour < 24; hour += 1) {
          const raw = scores[hour];
          if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
          const date = new Date(cursor);
          slots.push({
            day,
            date: date.toISOString().slice(0, 10),
            hour,
            score: raw,
            scheduledAt: formatScheduledAt(date, hour)
          });
        }
      }
      return slots.sort((a, b) => b.score - a.score);
    }

    function pickPostSummary(post: unknown): Record<string, unknown> {
      const record = asRecord(post) ?? {};
      return {
        id: record.id,
        text: record.text,
        state: record.state,
        type: record.type,
        scheduled_at: record.scheduled_at,
        account_id: record.account_id,
        network: record.network
      };
    }

    const extensionToMime: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm"
    };

    function inferMimeFromFilename(filename: string | undefined, fallback?: string): string {
      if (filename) {
        const ext = filename.split(".").pop()?.toLowerCase();
        if (ext && extensionToMime[ext]) return extensionToMime[ext];
      }
      return fallback ?? "application/octet-stream";
    }

    type ChatGptFileDownload = {
      buffer: Buffer;
      filename: string;
      mimeType: string;
    };

    async function downloadChatGptFile(ref: ChatGptFileRef): Promise<ChatGptFileDownload> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      try {
        const response = await fetch(ref.download_url, {
          method: "GET",
          signal: controller.signal
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Download from ChatGPT signed URL failed (HTTP ${response.status}): ${body}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const filename = ref.file_name ?? `${ref.file_id ?? "upload"}.bin`;
        const headerMime = response.headers.get("content-type") ?? undefined;
        const mimeType = ref.mime_type ?? inferMimeFromFilename(filename, headerMime);
        return { buffer, filename, mimeType };
      } finally {
        clearTimeout(timeout);
      }
    }

    export class PublerClient {
      async getCurrentUser(): Promise<PublerResult> {
        const data = await this.request("GET", "/users/me");
        return { summary: "Fetched the authenticated Publer user.", data };
      }

      async listWorkspaces(): Promise<PublerResult> {
        const data = await this.request("GET", "/workspaces");
        const count = Array.isArray(data) ? data.length : 0;
        return { summary: `Found ${count} Publer workspace${count === 1 ? "" : "s"}.`, data };
      }

      async listAccounts(workspaceId?: string): Promise<PublerResult> {
        const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
        const data = await this.request("GET", "/accounts", { workspaceId: resolvedWorkspaceId });
        const accounts = Array.isArray(data) ? data : (data as { accounts?: unknown[] }).accounts ?? [];
        return {
          summary: `Found ${accounts.length} social account${accounts.length === 1 ? "" : "s"} in workspace ${resolvedWorkspaceId}.`,
          data
        };
      }

      async listPosts(input: ListPostsInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const data = await this.request("GET", "/posts", {
          workspaceId,
          query: {
            state: input.state,
            "account_ids[]": input.accountIds,
            from: input.from,
            to: input.to,
            query: input.query,
            postType: input.postType,
            page: input.page
          }
        });
        const total = typeof data === "object" && data !== null && "total" in data ? (data as { total?: number }).total : undefined;
        return { summary: `Fetched ${total ?? "matching"} Publer post${total === 1 ? "" : "s"}.`, data };
      }

      async createDraft(input: DraftPostInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const response = await this.schedulePayload(workspaceId, {
          bulk: {
            state: "draft",
            posts: [
              {
                networks: {
                  [provider]: {
                    type: "status",
                    text: input.text
                  }
                },
                accounts: [{ id: accountId }]
              }
            ]
          }
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Draft job completed with failures." : "Draft created successfully.",
          data: { job_id: jobId, job_status: job.data }
        };
      }

      async schedulePost(input: SchedulePostInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const response = await this.schedulePayload(workspaceId, {
          bulk: {
            state: "scheduled",
            posts: [
              {
                networks: {
                  [provider]: {
                    type: "status",
                    text: input.text
                  }
                },
                accounts: [
                  {
                    id: accountId,
                    scheduled_at: input.scheduledAt
                  }
                ]
              }
            ]
          }
        });

        return { summary: "Submitted scheduled post to Publer.", data: response };
      }

      async schedulePostAndWait(input: SchedulePostInput): Promise<PublerResult> {
        const scheduled = await this.schedulePost(input);
        const jobId = this.extractJobId(scheduled.data);
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const job = await this.waitForJob({ workspaceId, jobId });

        return {
          summary: hasFailures(job.data) ? "Scheduling job completed with failures." : "Post scheduled successfully.",
          data: { job_id: jobId, job_status: job.data }
        };
      }

      async getJobStatus(input: JobStatusInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const data = await this.request("GET", `/job_status/${encodeURIComponent(input.jobId)}`, { workspaceId });
        return { summary: `Job ${input.jobId} is ${getStatus(data) ?? "available"}.`, data };
      }

      async getAccountAnalytics(input: AccountAnalyticsInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);

        if (!input.chartIds?.length) {
          const charts = await this.request("GET", "/analytics/charts", {
            workspaceId,
            query: { account_type: input.accountType }
          });
          return { summary: "Fetched available analytics charts.", data: charts };
        }

        const path = input.accountId
          ? `/analytics/${encodeURIComponent(input.accountId)}/chart_data`
          : "/analytics/chart_data";
        const data = await this.request("GET", path, {
          workspaceId,
          query: {
            "chart_ids[]": input.chartIds,
            from: input.from,
            to: input.to
          }
        });
        return { summary: `Fetched analytics for ${input.chartIds.length} chart${input.chartIds.length === 1 ? "" : "s"}.`, data };
      }

      async getPostInsights(input: PostInsightsInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = input.accountId ?? resolveAccountId(undefined);
        const data = await this.request("GET", `/analytics/${encodeURIComponent(accountId)}/post_insights`, {
          workspaceId,
          query: {
            from: input.from,
            to: input.to,
            query: input.query,
            postType: input.postType,
            sort_by: input.sortBy,
            sort_type: input.sortType,
            page: input.page
          }
        });
        return { summary: "Fetched post insights.", data };
      }

      async getBestTimes(input: BestTimesInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = input.accountId ?? resolveAccountId(undefined);
        const data = await this.request("GET", `/analytics/${encodeURIComponent(accountId)}/best_times`, {
          workspaceId,
          query: {
            from: input.from,
            to: input.to
          }
        });
        return { summary: "Fetched best times to post.", data };
      }

      async updatePost(input: UpdatePostInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const data = await this.request("PUT", `/posts/${encodeURIComponent(input.postId)}`, {
          workspaceId,
          body: { post: { text: input.text, title: input.title } }
        });
        return { summary: `Updated post ${input.postId}.`, data };
      }

      async deletePosts(input: DeletePostInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const data = await this.request("DELETE", "/posts", {
          workspaceId,
          query: { "post_ids[]": input.postIds }
        });
        return { summary: `Requested deletion for ${input.postIds.length} post${input.postIds.length === 1 ? "" : "s"}.`, data };
      }

      async uploadMediaFromChatGptFile(input: UploadMediaFromChatGptFileInput): Promise<PublerResult> {
        const downloaded = await downloadChatGptFile(input.file);
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const form = new FormData();
        const arrayBuffer = downloaded.buffer.buffer.slice(
          downloaded.buffer.byteOffset,
          downloaded.buffer.byteOffset + downloaded.buffer.byteLength
        ) as ArrayBuffer;
        form.append("file", new Blob([arrayBuffer], { type: downloaded.mimeType }), downloaded.filename);
        form.append("direct_upload", "false");
        form.append("in_library", String(input.inLibrary ?? true));

        const data = await this.requestMultipart("/media", { workspaceId, form });
        const media = findMediaRecord(data) ?? asRecord(data);
        const summary = pickMediaSummary(media);
        if (!summary.id) {
          throw new Error("Publer did not return a media id after upload.");
        }
        return {
          summary: `Uploaded ChatGPT file ${input.file.file_id ?? downloaded.filename} to Publer.`,
          data: { media: summary, mediaId: summary.id, raw: data }
        };
      }

      async createPhotoDraftFromMedia(input: CreatePhotoDraftInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const response = await this.schedulePhotoPayload(workspaceId, {
          state: "draft",
          provider,
          accountId,
          mediaId: input.mediaId,
          mediaType: input.mediaType ?? "photo",
          text: input.text,
          caption: input.caption
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Photo draft job completed with failures." : "Photo draft created.",
          data: { mediaId: input.mediaId, job_id: jobId, job_status: job.data }
        };
      }

      async schedulePhotoFromMedia(input: SchedulePhotoPostInput): Promise<PublerResult> {
        if (input.confirmSchedule !== true) {
          throw new Error("Scheduling a photo post requires confirmSchedule=true.");
        }
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const response = await this.schedulePhotoPayload(workspaceId, {
          state: "scheduled",
          provider,
          accountId,
          mediaId: input.mediaId,
          mediaType: input.mediaType ?? "photo",
          text: input.text,
          caption: input.caption,
          scheduledAt: input.scheduledAt
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Photo schedule job completed with failures." : "Photo post scheduled.",
          data: { mediaId: input.mediaId, scheduledAt: input.scheduledAt, job_id: jobId, job_status: job.data }
        };
      }

      async searchPosts(input: SearchPostsInput): Promise<PublerResult> {
        const result = await this.listPosts({
          workspaceId: input.workspaceId,
          state: input.state ?? "all",
          query: input.query,
          from: input.from,
          to: input.to,
          page: input.page
        });
        return { summary: `Search for "${input.query}" — ${result.summary}`, data: result.data };
      }

      async listDrafts(input: ListByStateInput): Promise<PublerResult> {
        const result = await this.listPosts({
          workspaceId: input.workspaceId,
          state: "draft",
          accountIds: input.accountIds,
          from: input.from,
          to: input.to,
          postType: input.postType,
          page: input.page
        });
        return { summary: `Fetched draft posts. ${result.summary}`, data: result.data };
      }

      async listPublishedPosts(input: ListByStateInput): Promise<PublerResult> {
        const result = await this.listPosts({
          workspaceId: input.workspaceId,
          state: "published",
          accountIds: input.accountIds,
          from: input.from,
          to: input.to,
          postType: input.postType,
          page: input.page
        });
        return { summary: `Fetched published posts. ${result.summary}`, data: result.data };
      }

      async listFailedPosts(input: ListByStateInput): Promise<PublerResult> {
        const result = await this.listPosts({
          workspaceId: input.workspaceId,
          state: "failed",
          accountIds: input.accountIds,
          from: input.from,
          to: input.to,
          postType: input.postType,
          page: input.page
        });
        return { summary: `Fetched failed posts. ${result.summary}`, data: result.data };
      }

      async autoSchedulePost(input: AutoSchedulePostInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const response = await this.schedulePayload(workspaceId, {
          bulk: {
            state: "scheduled",
            posts: [
              {
                networks: { [provider]: { type: "status", text: input.text } },
                accounts: [{ id: accountId }],
                share_next: input.shareNext ?? false,
                range: {
                  start_date: input.startDate,
                  ...(input.endDate ? { end_date: input.endDate } : {})
                },
                auto: true
              }
            ]
          }
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Auto-schedule job completed with failures." : "Post auto-scheduled in Publer using your posting schedule.",
          data: { job_id: jobId, job_status: job.data }
        };
      }

      async createRecurringPost(input: RecurringPostInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        if (input.repeat === "weekly" && (!input.daysOfWeek || input.daysOfWeek.length === 0)) {
          throw new Error("daysOfWeek is required when repeat=weekly (1=Monday … 7=Sunday).");
        }
        const recurring: Record<string, unknown> = {
          start_date: input.startDate,
          repeat: input.repeat
        };
        if (input.endDate) recurring.end_date = input.endDate;
        if (input.daysOfWeek) recurring.days_of_week = input.daysOfWeek;
        if (input.repeatRate) recurring.repeat_rate = input.repeatRate;
        if (input.time) recurring.time = input.time;

        const response = await this.schedulePayload(workspaceId, {
          bulk: {
            state: "recurring",
            posts: [
              {
                networks: { [provider]: { type: "status", text: input.text } },
                accounts: [{ id: accountId }],
                recurring
              }
            ]
          }
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Recurring post job completed with failures." : "Recurring post created.",
          data: { job_id: jobId, repeat: input.repeat, job_status: job.data }
        };
      }

      async listMedia(input: ListMediaInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const data = await this.request("GET", "/media", {
          workspaceId,
          query: {
            "ids[]": input.ids,
            "types[]": input.types,
            "used[]": input.used,
            "source[]": input.source,
            search: input.search,
            page: input.page
          }
        });
        const total = asRecord(data)?.total;
        const media = extractCollection(data, "media");
        return {
          summary: `Fetched ${typeof total === "number" ? total : media.length} media item${media.length === 1 ? "" : "s"} from Publer.`,
          data
        };
      }

      async listWorkspaceMembers(input: ListMembersInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const data = await this.request("GET", "/members", { workspaceId });
        const members = extractCollection(data, "members");
        return {
          summary: `Found ${members.length} workspace member${members.length === 1 ? "" : "s"}.`,
          data
        };
      }

      async getHashtagAnalysis(input: HashtagAnalysisInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = input.accountId ?? resolveAccountId(undefined);
        const data = await this.request("GET", `/analytics/${encodeURIComponent(accountId)}/hashtags`, {
          workspaceId,
          query: { from: input.from, to: input.to, page: input.page }
        });
        return { summary: `Fetched hashtag analysis for ${accountId}.`, data };
      }

      async getCompetitorAnalysis(input: CompetitorAnalysisInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = input.accountId ?? resolveAccountId(undefined);
        const data = await this.request("GET", `/analytics/${encodeURIComponent(accountId)}/competitors`, {
          workspaceId,
          query: {
            "competitor_ids[]": input.competitorIds,
            from: input.from,
            to: input.to
          }
        });
        return { summary: `Fetched competitor analysis for ${accountId}.`, data };
      }

      async createLinkPost(input: CreateLinkPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "link",
            text: input.text,
            url: input.url,
            ...(input.title ? { title: input.title } : {}),
            ...(input.description ? { description: input.description } : {}),
            ...(input.image ? { image: input.image } : {})
          },
          successLabel: "link post"
        });
      }

      async createPollPost(input: CreatePollPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "poll",
            text: input.text,
            poll: {
              options: input.options,
              duration: input.durationDays ?? 1
            }
          },
          successLabel: "poll post"
        });
      }

      async createRecyclingPost(input: CreateRecyclingPostInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const recycling: Record<string, unknown> = {
          solo: input.solo ?? true,
          gap: input.gap,
          gap_freq: input.gapFreq,
          start_date: input.startDate
        };
        if (input.expireCount) recycling.expire_count = input.expireCount;
        if (input.expireDate) recycling.expire_date = input.expireDate;

        const response = await this.request("POST", "/posts/schedule", {
          workspaceId,
          body: {
            bulk: {
              state: "scheduled",
              posts: [
                {
                  networks: { [provider]: { type: "status", text: input.text } },
                  accounts: [{ id: accountId, labels: [""] }],
                  range: { start_date: input.startDate, end_date: input.expireDate ?? null },
                  recycling
                }
              ]
            }
          }
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Recycling post job completed with failures." : "Recycling post created.",
          data: { job_id: jobId, job_status: job.data }
        };
      }

      async createVideoPost(input: CreateVideoPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "video",
            text: input.text,
            media: [
              {
                id: input.mediaId,
                type: "video",
                ...(input.caption ? { caption: input.caption } : {})
              }
            ]
          },
          successLabel: "video post"
        });
      }

      async createCarouselPost(input: CreateCarouselPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "carousel",
            text: input.text,
            media: input.mediaIds.map((id) => ({ id, type: "photo" }))
          },
          successLabel: `carousel post (${input.mediaIds.length} items)`
        });
      }

      async createReelPost(input: CreateReelPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "reel",
            text: input.text,
            media: [{ id: input.mediaId, type: "video" }]
          },
          successLabel: "reel"
        });
      }

      async createGifPost(input: CreateGifPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "gif",
            text: input.text,
            media: [{ id: input.mediaId, type: "gif" }]
          },
          successLabel: "gif post"
        });
      }

      async createShortPost(input: CreateShortPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "short",
            text: input.text,
            ...(input.title ? { title: input.title } : {}),
            media: [{ id: input.mediaId, type: "video" }]
          },
          successLabel: "YouTube short"
        });
      }

      async createDocumentPost(input: CreateDocumentPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "document",
            text: input.text,
            ...(input.title ? { title: input.title } : {}),
            media: [{ id: input.mediaId, type: "document" }]
          },
          successLabel: "document post"
        });
      }

      async createArticlePost(input: CreateArticlePostInput): Promise<PublerResult> {
        const network: Record<string, unknown> = {
          type: "article",
          title: input.title,
          text: input.body
        };
        if (input.featuredImageMediaId) {
          network.media = [{ id: input.featuredImageMediaId, type: "photo" }];
        }
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network,
          successLabel: "article post"
        });
      }

      async publishStatusNow(input: PublishStatusNowInput): Promise<PublerResult> {
        if (input.confirm !== true) {
          throw new Error("Immediate publishing requires confirm=true.");
        }
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const response = await this.request("POST", "/posts/schedule/publish", {
          workspaceId,
          body: {
            bulk: {
              state: "scheduled",
              posts: [
                {
                  networks: { [provider]: { type: "status", text: input.text } },
                  accounts: [{ id: accountId }]
                }
              ]
            }
          }
        });
        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Status publish job completed with failures." : "Status post published now.",
          data: { job_id: jobId, job_status: job.data }
        };
      }

      async createStoryPost(input: CreateStoryPostInput): Promise<PublerResult> {
        return this.createContentPost({
          workspaceId: resolveWorkspaceId(input.workspaceId),
          accountId: resolveAccountId(input.accountId),
          provider: input.provider ?? (config.defaultProvider as Provider),
          scheduledAt: input.scheduledAt,
          network: {
            type: "story",
            media: [{ id: input.mediaId, type: "photo" }]
          },
          successLabel: "story"
        });
      }

      private async createContentPost(input: {
        workspaceId: string;
        accountId: string;
        provider: Provider;
        network: Record<string, unknown>;
        scheduledAt?: string;
        successLabel: string;
      }): Promise<PublerResult> {
        const account: Record<string, unknown> = { id: input.accountId };
        if (input.scheduledAt) account.scheduled_at = input.scheduledAt;
        const state = input.scheduledAt ? "scheduled" : "draft_public";

        const response = await this.request("POST", "/posts/schedule", {
          workspaceId: input.workspaceId,
          body: {
            bulk: {
              state,
              posts: [
                {
                  networks: { [input.provider]: input.network },
                  accounts: [account]
                }
              ]
            }
          }
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId: input.workspaceId, jobId });
        const verb = input.scheduledAt ? "scheduled" : "drafted";
        return {
          summary: hasFailures(job.data)
            ? `${input.successLabel} job completed with failures.`
            : `${input.successLabel} ${verb}.`,
          data: { job_id: jobId, state, job_status: job.data }
        };
      }

      async saveIdeas(input: SaveIdeasInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const results: Array<Record<string, unknown>> = [];

        for (let index = 0; index < input.ideas.length; index += 1) {
          const idea = input.ideas[index];
          try {
            const response = await this.schedulePayload(workspaceId, {
              bulk: {
                state: idea.visibility ?? "draft_public",
                posts: [
                  {
                    networks: {
                      default: { type: "status", text: idea.text }
                    }
                  }
                ]
              }
            });
            const jobId = this.extractJobId(response);
            const job = await this.waitForJob({ workspaceId, jobId });
            results.push({
              index,
              status: hasFailures(job.data) ? "failed" : "ok",
              visibility: idea.visibility ?? "draft_public",
              text_preview: idea.text.slice(0, 80),
              job_id: jobId,
              job_status: job.data
            });
          } catch (error) {
            results.push({
              index,
              status: "error",
              text_preview: idea.text.slice(0, 80),
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        const okCount = results.filter((r) => r.status === "ok").length;
        return {
          summary: `Saved ${okCount}/${results.length} ideas to Publer.`,
          data: { workspaceId, totals: { ok: okCount, total: results.length }, items: results }
        };
      }

      async getCampaignContext(input: CampaignContextInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = input.accountId ?? config.defaultAccountId;
        const today = new Date();
        const inTwoWeeks = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
        const from = input.from ?? today.toISOString().slice(0, 10);
        const to = input.to ?? inTwoWeeks.toISOString().slice(0, 10);

        const [accountsResult, scheduledResult, chartsResult, bestTimesResult] = await Promise.allSettled([
          this.listAccounts(workspaceId),
          this.listPosts({ workspaceId, state: "scheduled" }),
          this.getAccountAnalytics({ workspaceId, accountType: input.accountType }),
          accountId ? this.getBestTimes({ workspaceId, accountId, from, to }) : Promise.resolve(undefined)
        ]);

        const accounts = accountsResult.status === "fulfilled" ? extractCollection(accountsResult.value.data, "accounts") : [];
        const accountSummaries = accounts.map((account: unknown) => {
          const record = asRecord(account) ?? {};
          return {
            id: record.id,
            name: record.name,
            provider: record.provider,
            type: record.type,
            status: record.status
          };
        });

        const scheduled = scheduledResult.status === "fulfilled" ? extractCollection(scheduledResult.value.data, "posts") : [];
        const charts = chartsResult.status === "fulfilled" ? extractCollection(chartsResult.value.data, "charts") : [];
        const bestTimes = bestTimesResult.status === "fulfilled" ? bestTimesResult.value?.data : undefined;
        const topSlots = bestTimes ? rankedBestTimeSlots(bestTimes, from, to).slice(0, 8) : [];

        return {
          summary: `Pulled campaign context: ${accountSummaries.length} accounts, ${scheduled.length} already scheduled, ${topSlots.length} top time slots between ${from} and ${to}.`,
          data: {
            workspaceId,
            accountId,
            window: { from, to },
            accounts: accountSummaries,
            scheduled_preview: scheduled.slice(0, 10).map(pickPostSummary),
            scheduled_count: scheduled.length,
            analytics_charts_available: charts.length,
            top_slots: topSlots
          }
        };
      }

      async runSmartCampaign(input: SmartCampaignInput): Promise<PublerResult> {
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const defaultAccountId = input.accountId ?? resolveAccountId(undefined);
        const defaultProvider = input.provider ?? (config.defaultProvider as Provider);

        const bestTimesCache = new Map<string, BestTimeSlot[]>();
        const usedSlotIndex = new Map<string, number>();

        async function getRankedSlots(this: PublerClient, accountId: string, from: string, to: string): Promise<BestTimeSlot[]> {
          const key = `${accountId}|${from}|${to}`;
          if (bestTimesCache.has(key)) return bestTimesCache.get(key) ?? [];
          const result = await this.getBestTimes({ workspaceId, accountId, from, to });
          const slots = rankedBestTimeSlots(result.data, from, to);
          bestTimesCache.set(key, slots);
          return slots;
        }

        const results: Array<Record<string, unknown>> = [];

        for (let index = 0; index < input.posts.length; index += 1) {
          const item: CampaignPostItem = input.posts[index];
          const accountId = item.accountId ?? defaultAccountId;
          const provider = item.provider ?? defaultProvider;
          const mediaId = item.mediaId ?? input.defaultMediaId;

          try {
            if (item.action === "draft") {
              const result = mediaId
                ? await this.createPhotoDraftFromMedia({
                    workspaceId,
                    accountId,
                    provider,
                    mediaId,
                    text: item.text,
                    caption: item.caption,
                    mediaType: "photo"
                  })
                : await this.createDraft({ workspaceId, accountId, provider, text: item.text });
              results.push({ index, action: item.action, status: "ok", summary: result.summary, data: result.data });
              continue;
            }

            if (item.action === "schedule") {
              if (!item.scheduledAt) throw new Error("scheduledAt is required for action=schedule.");
              const result = mediaId
                ? await this.schedulePhotoFromMedia({
                    workspaceId,
                    accountId,
                    provider,
                    mediaId,
                    text: item.text,
                    caption: item.caption,
                    scheduledAt: item.scheduledAt,
                    mediaType: "photo",
                    confirmSchedule: true
                  })
                : await this.schedulePostAndWait({ workspaceId, accountId, provider, text: item.text, scheduledAt: item.scheduledAt });
              results.push({ index, action: item.action, status: "ok", scheduledAt: item.scheduledAt, summary: result.summary, data: result.data });
              continue;
            }

            if (item.action === "schedule_best_time") {
              const from = item.bestTimeFrom;
              const to = item.bestTimeTo;
              if (!from || !to) throw new Error("bestTimeFrom and bestTimeTo are required for action=schedule_best_time.");
              const slots = await getRankedSlots.call(this, accountId, from, to);
              const cacheKey = `${accountId}|${from}|${to}`;
              const used = usedSlotIndex.get(cacheKey) ?? 0;
              const slot = slots[used];
              if (!slot) throw new Error("No best-time slots available for the requested window.");
              usedSlotIndex.set(cacheKey, used + 1);

              const result = mediaId
                ? await this.schedulePhotoFromMedia({
                    workspaceId,
                    accountId,
                    provider,
                    mediaId,
                    text: item.text,
                    caption: item.caption,
                    scheduledAt: slot.scheduledAt,
                    mediaType: "photo",
                    confirmSchedule: true
                  })
                : await this.schedulePostAndWait({ workspaceId, accountId, provider, text: item.text, scheduledAt: slot.scheduledAt });
              results.push({ index, action: item.action, status: "ok", scheduledAt: slot.scheduledAt, slot_score: slot.score, summary: result.summary, data: result.data });
              continue;
            }

          } catch (error) {
            results.push({
              index,
              action: item.action,
              status: "error",
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        const okCount = results.filter((r) => r.status === "ok").length;
        const errCount = results.length - okCount;
        return {
          summary: `Smart campaign \"${input.brief}\" finished: ${okCount} succeeded, ${errCount} failed across ${results.length} items.`,
          data: { brief: input.brief, totals: { ok: okCount, error: errCount, total: results.length }, items: results }
        };
      }

      async publishPhotoNow(input: PublishPhotoNowInput): Promise<PublerResult> {
        if (input.confirm !== true) {
          throw new Error("Immediate photo publishing requires confirm=true.");
        }
        const workspaceId = resolveWorkspaceId(input.workspaceId);
        const accountId = resolveAccountId(input.accountId);
        const provider = input.provider ?? (config.defaultProvider as Provider);
        const response = await this.request("POST", "/posts/schedule/publish", {
          workspaceId,
          body: {
            bulk: {
              state: "scheduled",
              posts: [
                {
                  networks: {
                    [provider]: {
                      type: "photo",
                      text: input.text,
                      media: [
                        {
                          id: input.mediaId,
                          type: input.mediaType ?? "photo",
                          ...(input.caption ? { caption: input.caption } : {})
                        }
                      ]
                    }
                  },
                  accounts: [{ id: accountId }]
                }
              ]
            }
          }
        });

        const jobId = this.extractJobId(response);
        const job = await this.waitForJob({ workspaceId, jobId });
        return {
          summary: hasFailures(job.data) ? "Immediate photo publish job completed with failures." : "Photo published now.",
          data: { mediaId: input.mediaId, job_id: jobId, job_status: job.data }
        };
      }

      private async schedulePhotoPayload(
        workspaceId: string,
        input: {
          state: "draft" | "scheduled";
          provider: Provider;
          accountId: string;
          mediaId: string;
          mediaType: "photo" | "video" | "gif";
          text: string;
          caption?: string;
          scheduledAt?: string;
        }
      ): Promise<unknown> {
        const account: Record<string, unknown> = { id: input.accountId };
        if (input.scheduledAt) account.scheduled_at = input.scheduledAt;
        return this.request("POST", "/posts/schedule", {
          workspaceId,
          body: {
            bulk: {
              state: input.state,
              posts: [
                {
                  networks: {
                    [input.provider]: {
                      type: "photo",
                      text: input.text,
                      media: [
                        {
                          id: input.mediaId,
                          type: input.mediaType,
                          ...(input.caption ? { caption: input.caption } : {})
                        }
                      ]
                    }
                  },
                  accounts: [account]
                }
              ]
            }
          }
        });
      }

      private async requestMultipart(
        path: string,
        options: { workspaceId?: string; form: FormData }
      ): Promise<unknown> {
        const apiKey = requireApiKey();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        const url = `${PUBLER_BASE_URL}${path}`;

        try {
          const response = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer-API ${apiKey}`,
              ...(options.workspaceId ? { "Publer-Workspace-Id": options.workspaceId } : {})
            },
            body: options.form
          });

          const text = await response.text();
          const data = text ? JSON.parse(text) : null;

          if (!response.ok) {
            throw new PublerApiError(`Publer API request failed with HTTP ${response.status}.`, response.status, data);
          }

          return data;
        } finally {
          clearTimeout(timeout);
        }
      }

      private async waitForJob(input: JobStatusInput): Promise<PublerResult> {
        const startedAt = Date.now();
        let lastStatus: PublerResult | undefined;

        while (Date.now() - startedAt < config.pollTimeoutMs) {
          lastStatus = await this.getJobStatus(input);
          const status = getStatus(lastStatus.data);

          if (status === "complete" || status === "completed" || status === "failed") {
            return lastStatus;
          }

          await sleep(config.pollIntervalMs);
        }

        return {
          summary: `Timed out waiting for job ${input.jobId}.`,
          data: lastStatus?.data ?? { status: "timeout" }
        };
      }

      private async schedulePayload(workspaceId: string, body: unknown): Promise<unknown> {
        return this.request("POST", "/posts/schedule", { workspaceId, body });
      }

      private extractJobId(data: unknown): string {
        if (typeof data === "object" && data !== null) {
          const jobId = (data as { job_id?: unknown }).job_id;
          if (typeof jobId === "string" && jobId.length > 0) return jobId;
        }

        throw new Error("Publer did not return a job_id.");
      }

      private async request(
        method: HttpMethod,
        path: string,
        options: { workspaceId?: string; query?: Record<string, QueryValue>; body?: unknown } = {}
      ): Promise<unknown> {
        const apiKey = requireApiKey();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        const url = `${PUBLER_BASE_URL}${path}${buildSearchParams(options.query)}`;

        try {
          const response = await fetch(url, {
            method,
            signal: controller.signal,
            headers: {
              Authorization: `Bearer-API ${apiKey}`,
              ...(options.workspaceId ? { "Publer-Workspace-Id": options.workspaceId } : {}),
              ...(options.body ? { "Content-Type": "application/json" } : {})
            },
            body: options.body ? JSON.stringify(options.body) : undefined
          });

          const text = await response.text();
          const data = text ? JSON.parse(text) : null;

          if (!response.ok) {
            throw new PublerApiError(`Publer API request failed with HTTP ${response.status}.`, response.status, data);
          }

          return data;
        } finally {
          clearTimeout(timeout);
        }
      }
    }
