import test from "node:test";

if (import.meta.url.includes(".architecture-test-build")) await import("./phase5-execution.cases");
else test("Phase 5 execution suite uses the compiled test harness", { skip: "Run npm run test:architecture for compiled TypeScript cases." }, () => {});
