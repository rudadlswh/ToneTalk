import { z } from "zod";
import { studyPointInputSchema } from "@/lib/study-points";

const queuedPointSchema = z.object({ input: studyPointInputSchema, day: z.number().int().positive() }).strict();
export type QueuedStudyPoint = z.infer<typeof queuedPointSchema>;
const prefix = (userId: string) => `tonetalk:study-points:v1:${z.uuid().parse(userId)}:`;

// One entry per event, not a shared JSON array: tabs cannot overwrite each
// other's pending awards. Store no session tokens, passwords or chat content.
export function saveQueuedPoint(userId: string, entry: QueuedStudyPoint, storage: Storage) {
  const parsed = queuedPointSchema.parse(entry);
  storage.setItem(`${prefix(userId)}${parsed.input.eventId}`, JSON.stringify(parsed));
}

export function removeQueuedPoint(userId: string, eventId: string, storage: Storage) {
  storage.removeItem(`${prefix(userId)}${z.uuid().parse(eventId)}`);
}

export function readQueuedPoints(userId: string, storage: Storage) {
  const accountPrefix = prefix(userId);
  const entries: QueuedStudyPoint[] = [];
  let invalid = false;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(accountPrefix)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue; // Another tab may have acknowledged it.
    try {
      if (raw.length > 2048) throw new Error("Oversized pending award");
      const entry = queuedPointSchema.parse(JSON.parse(raw));
      if (key !== `${accountPrefix}${entry.input.eventId}`) throw new Error("Mismatched event ID");
      entries.push(entry);
    } catch { invalid = true; } // Never send or silently erase malformed records.
  }
  return { entries, invalid };
}
