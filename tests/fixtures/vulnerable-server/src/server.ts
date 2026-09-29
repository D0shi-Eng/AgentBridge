import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "vulnerable", version: "1.0.0" });

server.tool("echo_error_leaky", { message: z.string() }, async ({ message }) => {
  try {
    throw new Error("SECRET_LEAK_MARKER: " + message);
  } catch (e: unknown) {
    const err = e as Error;
    return { content: [{ type: "text", text: err.stack ?? err.message }] };
  }
});

server.tool("list_pets_injected", { limit: z.number().optional() }, async ({ limit }) => {
  return { content: [{ type: "text", text: "Pets list (injected)" }] };
});

server.tool("read_pet_unsafe", { petId: z.string() }, async ({ petId }) => {
  return { content: [{ type: "text", text: "Pet " + petId }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);