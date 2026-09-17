import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { appUsers, studyChatSessions as sessions, studyPointEvents } from "@/db/schema";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";
import { generateRoleplayReply } from "@/server/ollama";
import { withInferenceSlot } from "@/server/inference-limit";
import type { ChatTurnInput } from "@/lib/study-chat";
import { studyPointRewards } from "@/lib/study-points";

export class StudyChatError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const conflict = () => new StudyChatError(409, "CHAT_STATE_CHANGED", "대화 진행 상태가 달라졌어요. 새 대화를 시작해 주세요.");
const digest = (id: string, messages: ChatTurnInput["messages"]) => createHash("sha256").update(JSON.stringify([id, messages])).digest("hex");

export async function startStudyChat(input: Pick<ChatTurnInput, "scenario" | "language">) {
  const ownerId = await getCurrentOwnerId(), id = randomUUID();
  return db.transaction(async tx => {
    // Serialize starts per account, bounding metadata creation across instances.
    await tx.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, ownerId)).for("update");
    const [recent] = await tx.select({ count: sql<number>`count(*)::int` }).from(sessions)
      .where(and(eq(sessions.ownerId, ownerId), sql`${sessions.createdAt} > now() - interval '1 minute'`));
    if (recent.count >= 10) throw new StudyChatError(429, "CHAT_START_LIMIT", "새 대화 요청이 많아요. 1분 후 다시 시작해 주세요.");
    await tx.insert(sessions).values({ id, ownerId, ...input, transcriptHash: digest(id, []) });
    return { sessionId: id };
  });
}

export async function submitStudyChat(input: ChatTurnInput, signal: AbortSignal) {
  const ownerId = await getCurrentOwnerId(), token = randomUUID();
  const requestHash = digest(input.sessionId, input.messages);
  const ownSession = and(eq(sessions.id, input.sessionId), eq(sessions.ownerId, ownerId));
  signal.throwIfAborted();
  const claimed = await db.transaction(async tx => {
    const [session] = await tx.select().from(sessions).where(ownSession).for("update");
    if (!session) throw new StudyChatError(404, "CHAT_NOT_FOUND", "내 계정의 대화를 찾지 못했어요. 새 대화를 시작해 주세요.");
    if (session.scenario !== input.scenario || session.language !== input.language) throw conflict();
    if (session.lastEventId === input.eventId) {
      if (session.lastRequestHash !== requestHash) throw conflict();
      const [total] = await tx.select({ value: sql<string>`coalesce(sum(${studyPointEvents.points}),0)` })
        .from(studyPointEvents).where(eq(studyPointEvents.ownerId, ownerId));
      // No raw reply is stored. Confirm the committed turn, never regenerate it.
      return { replay: { sessionId: session.id, turns: session.turns, replayed: true, response: null, points: 0, totalPoints: Number(total.value) } };
    }
    if (session.turns >= 4 || input.messages.length !== session.turns * 2 + 1 ||
      digest(session.id, input.messages.slice(0, -1)) !== session.transcriptHash) throw conflict();
    const [active] = await tx.select({ valid: sql<boolean>`${sessions.createdAt} > now()-interval '24 hours'`, busy: sql<boolean>`${sessions.generationExpiresAt} > now()` }).from(sessions).where(ownSession);
    if (!active.valid) throw new StudyChatError(409, "CHAT_EXPIRED", "시작한 지 하루가 지난 대화예요. 새 대화를 시작해 주세요.");
    if (active.busy) throw new StudyChatError(409, "CHAT_BUSY", "이 대화의 응답을 처리하고 있어요. 잠시 후 다시 시도해 주세요.");
    signal.throwIfAborted();
    await tx.update(sessions).set({ generationToken: token, generationExpiresAt: sql`now()+interval '200 seconds'` }).where(ownSession);
    return { session };
  });
  if (claimed.replay) return claimed.replay;
  try {
    const response = await withInferenceSlot(() => generateRoleplayReply(input, signal));
    signal.throwIfAborted();
    return await db.transaction(async tx => {
      const [session] = await tx.select().from(sessions).where(and(ownSession,
        eq(sessions.generationToken, token), sql`${sessions.generationExpiresAt} > now()`)).for("update");
      if (!session || session.turns !== claimed.session.turns) throw conflict();
      signal.throwIfAborted();
      const turns = session.turns + 1;
      await tx.update(sessions).set({ turns, transcriptHash: digest(session.id, [...input.messages, { role: "assistant", content: response.reply }]),
        lastEventId: input.eventId, lastRequestHash: requestHash, generationToken: null, generationExpiresAt: null }).where(ownSession);
      let points = 0;
      if (turns === 4) {
        // The DB daily index covers all conversations/languages for this owner.
        const awarded = await tx.insert(studyPointEvents).values({ id: randomUUID(), ownerId, activity: "chat", activityId: session.id,
          rewardDay: 0, points: studyPointRewards.chat }).onConflictDoNothing().returning({ id: studyPointEvents.id });
        if (awarded.length) points = studyPointRewards.chat;
      }
      const [total] = await tx.select({ value: sql<string>`coalesce(sum(${studyPointEvents.points}),0)` })
        .from(studyPointEvents).where(eq(studyPointEvents.ownerId, ownerId));
      return { sessionId: session.id, turns, replayed: false, response, points, totalPoints: Number(total.value) };
    });
  } catch (error) {
    await db.update(sessions).set({ generationToken: null, generationExpiresAt: null })
      .where(and(ownSession, eq(sessions.generationToken, token))).catch(() => console.warn("chat_progress_release_failed"));
    throw error;
  }
}
