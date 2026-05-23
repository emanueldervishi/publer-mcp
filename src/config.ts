import dotenv from "dotenv";

dotenv.config();

export const PUBLER_BASE_URL = "https://app.publer.com/api/v1";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const config = {
  apiKey: process.env.PUBLER_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  defaultWorkspaceId: process.env.PUBLER_WORKSPACE_ID,
  defaultAccountId: process.env.PUBLER_DEFAULT_ACCOUNT_ID,
  defaultProvider: process.env.PUBLER_DEFAULT_PROVIDER ?? "facebook",
  requestTimeoutMs: Number(process.env.PUBLER_REQUEST_TIMEOUT_MS ?? 30000),
  pollIntervalMs: Number(process.env.PUBLER_POLL_INTERVAL_MS ?? 1500),
  pollTimeoutMs: Number(process.env.PUBLER_POLL_TIMEOUT_MS ?? 45000)
};

export function requireApiKey(): string {
  if (!config.apiKey) {
    throw new Error("PUBLER_API_KEY is required. Add it to .env or your MCP client environment.");
  }

  return config.apiKey;
}

export function requireOpenAiApiKey(): string {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required to download files from OpenAI. Add it to .env or your MCP client environment.");
  }

  return config.openaiApiKey;
}

export function resolveWorkspaceId(workspaceId?: string): string {
  const resolved = workspaceId ?? config.defaultWorkspaceId;

  if (!resolved) {
    throw new Error("workspaceId is required. Pass workspaceId or set PUBLER_WORKSPACE_ID.");
  }

  return resolved;
}

export function resolveAccountId(accountId?: string): string {
  const resolved = accountId ?? config.defaultAccountId;

  if (!resolved) {
    throw new Error("accountId is required. Pass accountId or set PUBLER_DEFAULT_ACCOUNT_ID.");
  }

  return resolved;
}
