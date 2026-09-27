import test from "node:test";

if (import.meta.url.includes(".architecture-test-build")) await import("./phase6b-discovery.cases");
else test("Phase 6B discovery suite uses the compiled test harness", { skip: "Run npm run test:architecture for compiled TypeScript cases." }, () => {});
