import { describe, expect, it } from "vitest";
import { lyricsInputError, lyricsLimits, lyricsRequestSchema, parseLyricsReply, splitLyrics } from "@/lib/lyrics-contract";

const input = lyricsRequestSchema.parse({ lines: [{ id: 0, text: "Morning light" }, { id: 2, text: "Morning light" }] });
const line = { id: 0, sourceLanguage: "en", translation: "아침 햇살", romanization: "Morning light", hangulPronunciation: "모닝 라이트" };

describe("lyrics contracts", () => {
  it("preserves blank lines and duplicate choruses, normalizing Windows newlines", () => {
    expect(splitLyrics("Morning light\r\n\r\nMorning light")).toEqual(input.lines.slice(0, 1).concat([{ id: 1, text: "" }, input.lines[1]]));
  });
  it("validates total input, line length and line count", () => {
    expect(lyricsInputError(" \n ")).toBeTruthy();
    expect(lyricsInputError("a".repeat(6001))).toBeTruthy();
    expect(lyricsInputError("a".repeat(201))).toBeTruthy();
    expect(lyricsInputError(Array(81).fill("a").join("\n"))).toBeTruthy();
    expect(lyricsInputError("Morning light\n\nMy dream")).toBeNull();
  });
  it("defaults to auto source/Korean target and rejects excess or duplicate batch ids", () => {
    expect(input).toMatchObject({ sourceLanguage: "auto", targetLanguage: "ko" });
    const fullBatch = Array.from({ length: lyricsLimits.batch }, (_, id) => ({ id, text: `Line ${id}` }));
    expect(lyricsRequestSchema.safeParse({ lines: fullBatch }).success).toBe(true);
    expect(lyricsRequestSchema.safeParse({ lines: [...fullBatch, { id: lyricsLimits.batch, text: "Excess" }] }).success).toBe(false);
    expect(lyricsRequestSchema.safeParse({ lines: [input.lines[0], input.lines[0]] }).success).toBe(false);
    expect(lyricsRequestSchema.safeParse({ lines: [{ id: 0, text: "  " }] }).success).toBe(false);
  });
  it("restores input order and rejects missing, hallucinated or duplicated lines", () => {
    expect(parseLyricsReply({ lines: [{ ...line, id: 2 }, line] }, input).map((line) => line.id)).toEqual([0, 2]);
    for (const lines of [[line], [line, line], [line, { ...line, id: 3 }]]) {
      expect(() => parseLyricsReply({ lines }, input)).toThrow();
    }
  });
  it("requires both original pronunciation scripts and matches explicit source", () => {
    const single = { ...input, lines: [input.lines[0]] };
    expect(() => parseLyricsReply({ lines: [{ ...line, romanization: "모닝" }] }, single)).toThrow();
    expect(() => parseLyricsReply({ lines: [{ ...line, hangulPronunciation: "Morning" }] }, single)).toThrow();
    expect(() => parseLyricsReply({ lines: [line] }, { ...single, sourceLanguage: "ja" })).toThrow();
    expect(parseLyricsReply({ lines: [line] }, single)[0]).toEqual(line);
  });
});
