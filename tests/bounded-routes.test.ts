import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({ withAuth: (handler: unknown) => handler }));
vi.mock("@/server/profile", () => ({ getProfile: vi.fn(), updateProfile: vi.fn() }));
vi.mock("@/server/saved-phrases", () => ({ listSavedPhrases: vi.fn(), savePhrase: vi.fn() }));
vi.mock("@/server/study", () => ({ getStudySummary: vi.fn(), reviewStudyItem: vi.fn() }));
vi.mock("@/server/tts", () => ({ LocalTtsUnavailableError: class extends Error {}, synthesizeLocalSpeech: vi.fn() }));
import { PATCH } from "@/app/api/profile/route";
import { POST as saved } from "@/app/api/saved-phrases/route";
import { POST as review } from "@/app/api/study/reviews/route";
import { POST as tts } from "@/app/api/tts/route";

it.each([PATCH, saved, review, tts])("rejects malformed and oversized bodies without Content-Length", async (handler) => {
  const request = (body: string) => new Request("https://app.test/api", { method: "POST", body });
  expect((await handler(request("{"))).status).toBe(400);
  expect((await handler(request(JSON.stringify({ text: "가".repeat(2000) })))).status).toBe(413);
});
