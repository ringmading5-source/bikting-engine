import test from "node:test";

if (import.meta.url.includes(".architecture-test-build")) await import("./phase4-shadow.cases");
else test("Phase 4 shadow suite uses the compiled test harness", { skip: "Run npm run test:architecture for compiled TypeScript cases." }, () => {});
