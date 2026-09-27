import test from "node:test";
import assert from "node:assert/strict";
import { previewIntent } from "../src/runtime/preview-pipeline";
import { createOpenAITransport } from "../src/runtime/openai-transport";

test("live adapter interprets and plans through canonical validation", async () => {
  const tasks: string[] = [];
  const result = await previewIntent("Create a portfolio", {
    providerId: "test.live",
    transport: async ({ task }) => {
      tasks.push(task);
      if (task === "interpret_intent") return { objective: "Plan a portfolio", intentType: "create", concepts: ["portfolio"], possibleCapabilities: ["website.plan"] };
      return { conclusions: ["A site plan can be prepared"], proposedTasks: [{ id: "plan-site", purpose: "Plan pages", capabilityId: "website.plan" }], requiredCapabilities: [{ capabilityId: "website.plan" }] };
    },
  });
  assert.deepEqual(tasks, ["interpret_intent", "reason"]);
  assert.equal(result.planning.status, "ready");
  assert.equal(result.execution, "not_started");
});

test("unregistered live capability is refused by Bikting", async () => {
  const result = await previewIntent("Do something", {
    providerId: "test.live",
    transport: async ({ task }) => task === "interpret_intent"
      ? { objective: "Do something", intentType: "create", concepts: [], possibleCapabilities: ["unregistered.tool"] }
      : {},
  });
  assert.equal(result.planning.status, "refused");
  assert.equal(result.interpretation.valid, false);
});

test("OpenAI transport sends its key only in the server request header", async () => {
  let outbound: RequestInit | undefined;
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    outbound = init;
    return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: '{"objective":"ok"}' }] }] }) } as Response;
  };
  const transport = createOpenAITransport("server-secret", "configured-model", fetcher as typeof fetch);
  const result = await transport({ task: "interpret_intent", instructions: "Return JSON", input: { id: "r1", task: "interpret_intent", objective: "test", concepts: [], constraints: [], availableCapabilities: [], requiredOutput: { fields: [] }, provenance: { callerId: "test", sourceType: "user" } } });
  assert.deepEqual(result, { objective: "ok" });
  assert.equal((outbound?.headers as Record<string, string>).Authorization, "Bearer server-secret");
  assert.equal(JSON.stringify(JSON.parse(outbound?.body as string)).includes("server-secret"), false);
});
