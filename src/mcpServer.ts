import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPublerMcpServer } from "./createServer.js";

const server = createPublerMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
