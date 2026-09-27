import test from "node:test";

if (import.meta.url.includes(".architecture-test-build")) await import("./bil.parity.cases");
else test("BIL parity suite uses the compiled test harness", { skip: "Run npm run test:architecture for compiled TypeScript cases." }, () => {});
