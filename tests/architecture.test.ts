import test from "node:test";

if (import.meta.url.includes(".architecture-test-build")) await import("./architecture.cases");
else test("architecture TypeScript suite uses the compiled test harness", { skip: "Run npm run test:architecture for compiled TypeScript cases." }, () => {});
