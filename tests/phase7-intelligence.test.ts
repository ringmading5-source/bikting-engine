import test from "node:test";

if (import.meta.url.includes(".architecture-test-build")) await import("./phase7-intelligence.cases");
else test("Phase 7 intelligence suite uses the compiled test harness", { skip: "Run npm run test:architecture for compiled TypeScript cases." }, () => { });
