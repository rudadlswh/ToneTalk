import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs the benchmark through native imports with an offline upstream", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    process.argv = [process.execPath, "benchmark", "test-model"];
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      if (path === "/api/tags") return Response.json({models: [{name: "test-model"}]});
      if (path === "/api/ps") return Response.json({models: []});
      if (path === "/api/chat") {
        const body = JSON.parse(options.body);
        if (!body.messages[1].content.includes('Could you help me?')) throw Error("prompt missing");
        if (body.options.num_ctx !== 4096) throw Error("context changed");
        return Response.json({message: {content: "{}"}});
      }
      if (path === "/api/generate") return Response.json({});
      throw Error("unexpected request");
    };
    await import("./scripts/benchmark-ollama.mjs");
  `], { cwd: process.cwd(), encoding: "utf8" });
  const rows = output.trim().split("\n").map((line) => JSON.parse(line));
  expect(rows.filter((row) => row.trial).map((row) => row.trial)).toEqual(["cold", "warm"]);
  expect(rows.some((row) => row.error)).toBe(false);
});
