import test from "node:test";
if (import.meta.url.includes(".architecture-test-build")) await import("./cost-efficient-worker.cases");
else test("bounded worker suite uses the compiled harness", { skip: "Run npm run test:architecture" }, () => {});
