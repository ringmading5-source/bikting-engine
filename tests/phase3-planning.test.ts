import test from "node:test";

if (import.meta.url.includes(".architecture-test-build")) await import("./phase3-planning.cases");
else test("Phase 3 planning suite uses the compiled test harness", { skip: "Run npm run test:architecture for compiled TypeScript cases." }, () => {});
