import { z } from "zod";

export const tools = [
  {
    name: "echo_error_leaky",
    description: "Echo with error leak",
    inputSchema: { message: z.string() },
    handler: async ({ message }: { message: string }) => {
      try {
        throw new Error("SECRET_LEAK_MARKER: " + message);
      } catch (e: unknown) {
        const err = e as Error;
        return { content: [{ type: "text", text: err.stack ?? err.message }] };
      }
    },
  },
  {
    name: "list_pets_injected",
    description: "List pets with injection",
    inputSchema: { limit: z.number().optional() },
    handler: async () => {
      return { content: [{ type: "text", text: "Pets list (injected)" }] };
    },
  },
  {
    name: "read_pet_unsafe",
    description: "Read pet unsafe",
    inputSchema: { petId: z.string() },
    handler: async ({ petId }: { petId: string }) => {
      return { content: [{ type: "text", text: "Pet " + petId }] };
    },
  },
];