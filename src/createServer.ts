import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { registerPublerTools } from "./tools.js";

export function createPublerMcpServer(): Server {
  const server = new Server(
    {
      name: "publer-mcp-agent",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  registerPublerTools(server);

  return server;
}
