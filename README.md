# Publer MCP Agent

Publer MCP Agent connects AI assistants like Claude or ChatGPT to Publer through MCP.

It lets social media managers ask an AI assistant to:

- list workspaces
- list social accounts
- create drafts
- schedule posts
- check job status
- list scheduled posts
- update or delete posts
- fetch account analytics
- answer follower-count questions
- fetch post insights
- fetch best times to post
- prepare campaign workflows

This is a tool-first MCP server, not a dashboard. The assistant calls Publer tools through a standard MCP interface.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```bash
PUBLER_API_KEY=your_key_here
PUBLER_WORKSPACE_ID=64e6529edb27975b2db99b1d
PUBLER_DEFAULT_ACCOUNT_ID=60ea17dbdb27974a651af0be
PUBLER_DEFAULT_PROVIDER=facebook
```

The safe default account is:

- account id: `60ea17dbdb27974a651af0be`
- provider: `facebook`
- name: `Test Page`

Never commit your Publer API key. Use `.env`. Rotate the key after demos.

## Run

Stdio MCP server:

```bash
npm run dev:stdio
```

HTTP MCP server:

```bash
npm run dev:http
```

Build:

```bash
npm run build
```

Run built stdio server:

```bash
npm run start:stdio
```

Run built HTTP server:

```bash
npm run start:http
```

## HTTP Deployment

The HTTP entrypoint exposes:

- `GET /health`
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`

Node runs plain HTTP internally. In production, put it behind your platform or reverse proxy for HTTPS. When `NODE_ENV=production` and `x-forwarded-proto` is present but not `https`, the server redirects to HTTPS.

Use ChatGPT app authentication type `No Authentication` for this server. Never expose `PUBLER_API_KEY` to frontend code. Keep it only in server environment variables.
## MCP Inspector

```bash
npm run inspect
```

Demo prompts:

1. `List my Publer workspaces.`
2. `List my social accounts in the App Review workspace.`
3. `Create a draft on Facebook saying: Testing Publer MCP Agent from the hackathon.`
4. `Schedule a Facebook post tomorrow at 10:00 saying: We are testing AI-powered Publer workflows.`
5. `Show my scheduled posts.`

## Claude Desktop config

Use an absolute path for your local machine:

```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["tsx", "/home/eli/publer-mcp-agent/src/mcpServer.ts"],
      "env": {
        "PUBLER_API_KEY": "your_key_here",
        "PUBLER_WORKSPACE_ID": "64e6529edb27975b2db99b1d",
        "PUBLER_DEFAULT_ACCOUNT_ID": "60ea17dbdb27974a651af0be",
        "PUBLER_DEFAULT_PROVIDER": "facebook"
      }
    }
  }
}
```

## Tools

- `publer_list_workspaces`
- `publer_list_accounts`
- `publer_list_posts`
- `publer_create_draft`
- `publer_schedule_post`
- `publer_get_job_status`
- `publer_get_account_analytics`
- `publer_get_followers`
- `publer_social_manager_overview`
- `publer_get_post_insights`
- `publer_get_best_times`
- `publer_update_post`
- `publer_delete_posts` (requires `confirm=true`)
- `publer_plan_campaign`

`publer_schedule_post` submits the post to Publer and automatically polls `/job_status/{job_id}` so the assistant can answer with a clean success or failure summary.

## Campaign Planner

`publer_plan_campaign` turns a goal into proposed posts and dates. If `schedule` is true, it schedules to one selected Publer account:

```json
{
  "goal": "Promote our new AI-powered Publer workflow",
  "platforms": ["facebook"],
  "startDate": "2026-05-23",
  "numberOfPosts": 5,
  "tone": "confident and practical",
  "schedule": false
}
```

Set `schedule` to `true` to schedule the generated posts using the default account or supplied `accountId`.
# publer-mcp
