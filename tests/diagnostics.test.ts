import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getRequestId, withRequestId, logFailure, safeError } from "@/server/diagnostics";

it("excludes SQL, input, message, stack and arbitrary error names/codes", () => {
  const error = Object.assign(new Error("secret input"), {
    name: "secret name", code: "secret code", params: ["private text"], query: "private SQL",
    cause: { code: "23505", message: "private cause", status: 503 },
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    logFailure("profile_update_failed", "request-id", error);
    expect(log).toHaveBeenCalledWith("profile_update_failed", { requestId: "request-id", category: "unknown", code: "23505", status: 503 });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private/);
    expect(safeError(null)).toEqual({ category: "unknown" });
  } finally { log.mockRestore(); }
});
it("keeps concurrent request identifiers isolated", async () => {
  const results = await Promise.all(["a", "b"].map((id) => withRequestId(id, async () => {
    await Promise.resolve();
    return getRequestId();
  })));
  expect(results).toEqual(["a", "b"]);
});
