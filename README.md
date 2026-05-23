# Publer MCP Agent

A Model Context Protocol server that wires [Publer](https://publer.com) into ChatGPT / Claude / any MCP-aware assistant. **One conversation runs an entire multi-network social marketing workflow** — research, brainstorm, draft, schedule, publish, and analytics — without ever opening a dashboard.

> **Companion web client:** the sibling repo [`mcp-client`](../mcp-client) is a Next.js + Gemini 2.5 Flash dashboard that drives this server (workspace sidebar, agentic chat, streaming tool calls). Use either ChatGPT Apps SDK dev mode, Claude Desktop, **or** the companion client.

## why this changes marketing

A normal week for a social manager: log into Publer, open analytics, screenshot best times, switch to a doc, draft captions per network, copy them back, attach media, set timezones, repeat across Facebook / Instagram / X / LinkedIn / TikTok / Threads, then check what failed.

With this MCP connected, the same week is one prompt:

> "Look at my Publer analytics, brainstorm 8 angles for this image, save them as drafts, then launch a 7-day campaign across every connected network — one live now, three at the best times you find, one reminder later, one long-form for review."

The assistant handles it end-to-end. The LLM brings the things it's actually good at — **writing native copy per platform** and **reasoning over analytics** — while Publer handles auth, multi-network fan-out, scheduling, the media library, job polling, and rate limits.

Marketing stops being click-work. It becomes a conversation.

## how it works

```
   you  ──prompt──▶  ChatGPT / Claude  ──MCP──▶  this server  ──HTTPS──▶  Publer API
                          │                              │
                     writes captions                fans out across
                     plans angles                   accounts/networks
                     reads analytics                polls async jobs
                     picks images                  uploads media
```

- **The assistant** does the creative + strategic layer: caption voice, angle selection, image-to-post matching, timing trade-offs.
- **This server** is the executor: 26 tools mapping the Publer v1 REST surface, plus a few orchestrators that combine multiple API calls into one round-trip so the assistant can plan and ship in fewer turns.
- **You** stay in the loop with explicit `confirm` flags on anything that publishes live, and honest MCP `annotations` (`destructiveHint`, `openWorldHint`) so the host's safety layer can see what each call really does.

## the killer move: `publer_smart_campaign`

One tool call that runs a whole mixed-action campaign. Each post item declares an action:

| action | what happens |
|---|---|
| `draft` | Saved in Publer. Never published. |
| `schedule` | Queued at a specific `scheduledAt`. |
| `schedule_best_time` | Server pulls the heatmap, ranks slots in `bestTimeFrom`..`bestTimeTo`, picks the strongest unused one. N posts → N distinct top slots (dedup'd per (account, window)). |

Per-item `accountId` + `provider` let one call hit Facebook + Instagram + X + LinkedIn simultaneously with different captions per network. A shared `defaultMediaId` (from `publer_upload_media_from_chatgpt_file`) attaches the same image, or each item carries its own `mediaId` for multi-image campaigns. Goes live publishing happens through the separate `publer_publish_photo_now` tool so the blast radius of `smart_campaign` stays non-destructive.

## tool surface (26)

### Identity + workspace
- `publer_get_current_user`
- `publer_list_workspaces`
- `publer_list_accounts`

### Posts (read)
- `publer_list_posts` — full filter surface (state, account, date, type, query, page)
- `publer_list_drafts` / `publer_list_published_posts` / `publer_list_failed_posts` — convenience filters so the assistant doesn't have to remember state enums
- `publer_search_posts` — full-text search

### Posts (write)
- `publer_create_draft` — text draft
- `publer_schedule_post` — specific time, polls until done
- `publer_auto_schedule_post` — uses the user's own Publer posting schedule (`auto: true` + range)
- `publer_create_recurring_post` — daily / weekly / monthly cadence (`recurring` block)
- `publer_update_post`
- `publer_delete_posts` *(requires `confirm=true`)*
- `publer_get_job_status`

### Media + photo posts (ChatGPT Apps SDK)
- `publer_upload_media_from_chatgpt_file` — accepts the Apps SDK file-reference object (`{ download_url, file_id, mime_type, file_name }`) via `_meta["openai/fileParams"]: ["file"]`, fetches the signed URL, uploads multipart to Publer's `/media`. Returns the Publer `mediaId`.
- `publer_create_photo_draft`
- `publer_schedule_photo_post` *(requires `confirmSchedule=true`)*
- `publer_publish_photo_now` *(requires `confirm=true`)*

### Analytics
- `publer_get_account_analytics` — lists charts or returns chart data
- `publer_get_post_insights` — post-level performance
- `publer_get_best_times` — heatmap data feeding the smart-campaign slot picker

### Campaign orchestration
- `publer_get_campaign_context` — one round-trip that returns accounts + scheduled queue preview + analytics-chart availability + top 8 best-time slots. Use this before planning so the assistant doesn't burn 4 sequential calls guessing.
- `publer_save_workspace_drafts` — batch-saves text notes as workspace-visible drafts (Publer surfaces them in the Drafts panel).
- `publer_smart_campaign` — described above. The whole point.
- `publer_plan_campaign` — legacy planner; turns a goal into a proposed schedule.

All write tools declare MCP `annotations` (`destructiveHint` only true for delete + publish-now) and Apps SDK invocation strings (`openai/toolInvocation/invoking`/`invoked`) so safety classifiers can tell drafts from live publishing.

## setup

```bash
npm install
cp .env.example .env
```

`.env`:
```
PUBLER_API_KEY=...
PUBLER_WORKSPACE_ID=...
PUBLER_DEFAULT_ACCOUNT_ID=...
PUBLER_DEFAULT_PROVIDER=facebook
```

Defaults are fallbacks — the assistant can override per call. Never commit `.env`.

## run

| mode | command | use for |
|---|---|---|
| stdio dev | `npm run dev:stdio` | Claude Desktop, local MCP clients |
| http dev | `npm run dev:http` | ChatGPT Apps SDK dev mode, remote clients |
| build | `npm run build` | `dist/` output for deploy |
| http prod | `npm start` | Railway / Render / Fly default entrypoint |

HTTP routes: `GET /health`, `POST /mcp`, `GET /mcp`, `DELETE /mcp`. In `NODE_ENV=production`, the server 308-redirects HTTP → HTTPS when behind a proxy that sets `x-forwarded-proto`.

## connect

**ChatGPT (Apps SDK dev mode):** add an MCP server pointing at `https://<your-domain>/mcp`, auth `No Authentication` (your key is server-side).

**Claude Desktop:**
```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["tsx", "/abs/path/publer-mcp-agent/src/mcpServer.ts"],
      "env": {
        "PUBLER_API_KEY": "...",
        "PUBLER_WORKSPACE_ID": "...",
        "PUBLER_DEFAULT_ACCOUNT_ID": "...",
        "PUBLER_DEFAULT_PROVIDER": "facebook"
      }
    }
  }
}
```

**MCP Inspector:** `npm run inspect`.

## deploy

Single-process Node, in-memory MCP session state (`transports` Map in [src/httpServer.ts](src/httpServer.ts)) — needs a host that gives one persistent VM, doesn't sleep, and supports HTTPS. Don't run on serverless.

| platform | fit | notes |
|---|---|---|
| **Railway** | Best for hackathon | Click-deploy from GitHub. Free $5 trial credit; ~$5/mo after. |
| **Fly.io** | Best for free-forever | 3 shared 256MB VMs free. CLI deploy. |
| **Render** | OK if paying | Free tier sleeps after 15 min — *kills MCP sessions*. Starter $7/mo. |
| Vercel / Netlify / CF Workers | ❌ | Serverless, won't hold session state. |

Smoke test after deploy: `curl https://<domain>/health` → `{"status":"ok"}`.

## demo prompt

Attach one or more images in ChatGPT (Apps SDK dev mode, this server connected), then:

> I just dropped some images. Look at what social accounts I have connected and pull analytics + best-times data from Publer. Use that to research what's working — when my audience shows up, which networks have the most pull, anything from past post insights worth riffing on. Tell me what you found in a couple of sentences.
>
> Then brainstorm 6–8 sharp post ideas — different angles, tones, post types — and save them to my Publer Drafts so I have a paper trail.
>
> Once the ideas are saved, kick off a 7-day campaign across every connected network. Each platform gets posts in its own native voice. Mix it up:
> - 1 launch post live right now, on whichever network hits hardest.
> - 3 scheduled at the best times you found, fanned out across the others.
> - 1 reminder/follow-up later in the week.
> - 1 long-form draft for me to review.
>
> If I attached more than one image, match the right image to the right post. End with a clean summary: research, ideas saved, schedule grid (network · time · what's posting).

That chains ~10 tool calls, fans across accounts, returns a posting grid. No manual scheduling. No copy-paste.

## architecture notes

- **One Publer client.** [src/publerClient.ts](src/publerClient.ts) wraps the v1 REST surface. All writes go through `/posts/schedule` (or `/posts/schedule/publish` for immediate) — both are async, returning a `job_id`. The client polls `/job_status/{id}` to terminal status before returning, so the assistant always sees a clean success/failure summary instead of a bare job id.
- **Best-times scheduling.** Parses Publer's heatmap response, ranks every hour slot in the window. `publer_smart_campaign` caches the ranked list per (account, window) and tracks used indices so 5 items get 5 distinct top slots.
- **ChatGPT file uploads.** Tool parameter is an object — *not* a string — marked with `_meta["openai/fileParams"]: ["file"]`. The server fetches the signed `download_url` directly. No OpenAI API key required for this path.
- **Multi-network fan-out.** Smart-campaign items each carry optional `accountId` + `provider`, so one tool call hits every connected network. The assistant lists accounts up front via `publer_get_campaign_context` then routes posts per network.
- **Honest safety.** Every mutating tool declares MCP `annotations` truthfully. `publer_smart_campaign` is `destructiveHint: false` because it never publishes live; live publishing only happens through tools explicitly gated by `confirm=true`.

## security

- `PUBLER_API_KEY` lives server-side only. The HTTP server never echoes it. ChatGPT's MCP transport rides over no-auth because the key is gated by who has access to your deploy.
- Pre-publish gates: `confirm=true` on `delete_posts` and `publish_photo_now`, `confirmSchedule=true` on `schedule_photo_post`. The assistant can't silently push to the world.
- Publer rate limit: 100 req / 2-min window per user. The smart-campaign schema caps batches at 20 items.
- Never commit `.env`. Rotate keys after demos.
