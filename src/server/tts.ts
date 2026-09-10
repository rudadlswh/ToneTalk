import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LanguageCode } from "@/lib/languages";
import { macSystemVoices } from "@/lib/tts-contract";

const execFileAsync = promisify(execFile);

export class LocalTtsUnavailableError extends Error {}

export async function synthesizeLocalSpeech(
  text: string,
  language: LanguageCode,
) {
  if (process.platform !== "darwin") {
    throw new LocalTtsUnavailableError("macOS local speech is unavailable");
  }

  const directory = await mkdtemp(join(tmpdir(), "tonetalk-tts-"));
  const outputPath = join(directory, "speech.m4a");
  const inputPath = join(directory, "input.txt");

  try {
    // User text is file content, never an option parsed by the native process.
    await writeFile(inputPath, text, { encoding: "utf8", mode: 0o600 });
    await execFileAsync(
      "/usr/bin/say",
      [
        "-v",
        macSystemVoices[language],
        "-r",
        "165",
        "-o",
        outputPath,
        "--data-format=aac",
        "--bit-rate=64000",
        "-f",
        inputPath,
      ],
      { timeout: 60_000, maxBuffer: 1_000_000 },
    );
    return new Uint8Array(await readFile(outputPath));
  } catch (error) {
    throw new LocalTtsUnavailableError(
      error instanceof Error ? error.message : "Local speech synthesis failed",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
