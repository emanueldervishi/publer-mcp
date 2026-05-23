import cors from "cors";
import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createPublerMcpServer } from "./createServer.js";

const app = express();
const transports = new Map<string, StreamableHTTPServerTransport>();
const port = Number(process.env.PORT ?? 3000);
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const forwardedProto = req.header("x-forwarded-proto");

  if (process.env.NODE_ENV === "production" && forwardedProto && forwardedProto !== "https") {
    const host = req.header("host");
    if (host) {
      res.redirect(308, `https://${host}${req.originalUrl}`);
      return;
    }
  }

  next();
});

function sendJsonRpcError(res: Response, id: unknown, code: number, message: string): void {
  res.status(400).json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message
    }
  });
}

function getSessionId(req: Request): string | undefined {
  const header = req.header("mcp-session-id");
  return header && header.length > 0 ? header : undefined;
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/mcp", async (req: Request, res: Response) => {

  const sessionId = getSessionId(req);
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (sessionId && !transport) {
    sendJsonRpcError(res, req.body?.id, -32000, "Session not found.");
    return;
  }

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      sendJsonRpcError(res, req.body?.id, -32000, "Missing mcp-session-id. First request must be initialize.");
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        if (transport) transports.set(newSessionId, transport);
      }
    });

    transport.onclose = () => {
      if (transport?.sessionId) {
        transports.delete(transport.sessionId);
      }
    };

    const server = createPublerMcpServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSessionRequest(req: Request, res: Response): Promise<void> {

  const sessionId = getSessionId(req);
  if (!sessionId) {
    sendJsonRpcError(res, null, -32000, "mcp-session-id header is required.");
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    sendJsonRpcError(res, null, -32000, "Session not found.");
    return;
  }

  await transport.handleRequest(req, res);
}

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

app.listen(port, () => {
  console.error(`Publer MCP HTTP server listening on port ${port}`);
});
