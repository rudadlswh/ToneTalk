import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ exec: vi.fn(), write: vi.fn(), remove: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => {
  mocks.exec(...args.slice(0, 3));
  (args[3] as (error: null, stdout: string) => void)(null, "");
} }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: async () => "/tmp/tonetalk-test", writeFile: mocks.write,
  readFile: async () => Buffer.from("audio"), rm: mocks.remove,
}));
import { synthesizeLocalSpeech } from "@/server/tts";

it.skipIf(process.platform !== "darwin")("keeps option-shaped text out of argv and removes private input", async () => {
  const text = "--input-file=/not-a-real-file";
  await synthesizeLocalSpeech(text, "en");
  expect(mocks.write).toHaveBeenCalledWith("/tmp/tonetalk-test/input.txt", text, { encoding: "utf8", mode: 0o600 });
  const [binary, args] = mocks.exec.mock.calls[0];
  expect(binary).toBe("/usr/bin/say");
  expect(args).not.toContain(text);
  expect(args.slice(-2)).toEqual(["-f", "/tmp/tonetalk-test/input.txt"]);
  expect(mocks.remove).toHaveBeenCalledWith("/tmp/tonetalk-test", { recursive: true, force: true });
});
