import "server-only";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { dailyPracticeSets as sets, dailyPracticeAnswers as answers, mistakeReviewAnswers as reviews } from "@/db/schema";
import { gradeDailyAnswer, type DailyAttemptInput } from "@/lib/daily-ai-practice";
import { mistakeItemSchema, type MistakeQuery } from "@/lib/mistake-review";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";

export class MistakeReviewError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const resultColumns = { eventId: reviews.id, questionIndex: reviews.questionIndex, answer: reviews.answer, outcome: reviews.outcome, attemptNumber: reviews.attemptNumber };

export async function listMistakes(query: MistakeQuery) {
  const ownerId = await getCurrentOwnerId();
  // ponytail: derive this account's queue from existing evidence; materialize only if measured history growth needs it.
  const rows = await db.execute(sql`
    with mistakes as (
      select distinct on (s.id, a.question_index)
        s.id, s.day, s.kind, s.source, a.question_index, s.phrases->a.question_index as phrase,
        jsonb_build_object('eventId',a.id,'questionIndex',a.question_index,'answer',a.answer,'outcome',a.outcome,'attemptNumber',a.attempt_number) as original
      from ${sets} s join ${answers} a on a.set_id=s.id
      where s.owner_id=${ownerId} and a.outcome in ('wrong','revealed')
      order by s.id, a.question_index, a.attempt_number desc
    )
    select m.id as "setId", m.day, m.kind, m.source, m.question_index as "questionIndex", m.phrase, m.original, r.result as review
    from mistakes m left join lateral (
      select outcome, jsonb_build_object('eventId',id,'questionIndex',question_index,'answer',answer,'outcome',outcome,'attemptNumber',attempt_number) as result
      from ${reviews} where set_id=m.id and question_index=m.question_index order by attempt_number desc limit 1
    ) r on true
    where ${query.kind === "all" ? sql`true` : sql`m.kind=${query.kind}`}
      and ${query.tone === "all" ? sql`true` : sql`m.phrase->>'tone'=${query.tone}`}
      and ${query.status === "all" ? sql`true` : query.status === "resolved" ? sql`r.outcome='correct'` : sql`r.outcome is distinct from 'correct'`}
      and ${query.cursor ? sql`(m.day,m.id,m.question_index)<(${query.cursor.day},${query.cursor.setId},${query.cursor.questionIndex})` : sql`true`}
    order by m.day desc, m.id desc, m.question_index desc limit 21`);
  const items = rows.rows.slice(0, 20).map(row => mistakeItemSchema.parse(row));
  const last = items.at(-1);
  return { items, nextCursor: rows.rows.length > 20 && last ? `${last.day}|${last.setId}|${last.questionIndex}` : null };
}

export async function submitMistakeReview(input: DailyAttemptInput) {
  const ownerId = await getCurrentOwnerId();
  return db.transaction(async tx => {
    const [set] = await tx.select().from(sets).where(and(eq(sets.id, input.setId), eq(sets.ownerId, ownerId))).for("update");
    const phrase = set?.phrases?.[input.questionIndex];
    if (!set || !phrase) throw new MistakeReviewError(404, "MISTAKE_NOT_FOUND", "내 계정의 오답 문제를 찾지 못했어요.");
    const [mistake] = await tx.select({ id: answers.id }).from(answers).where(and(eq(answers.setId, set.id), eq(answers.questionIndex, input.questionIndex), inArray(answers.outcome, ["wrong", "revealed"]))).limit(1);
    if (!mistake) throw new MistakeReviewError(404, "MISTAKE_NOT_FOUND", "오답이나 정답 공개 기록이 있는 문제만 복습할 수 있어요.");
    let outcome;
    try { outcome = gradeDailyAnswer(set.kind, phrase, input.answer); }
    catch { throw new MistakeReviewError(400, "INVALID_ANSWER", "문제 유형과 답안을 확인해 주세요."); }
    const [duplicate] = await tx.select().from(reviews).where(eq(reviews.id, input.eventId));
    if (duplicate) {
      if (duplicate.setId !== set.id || duplicate.questionIndex !== input.questionIndex || !isDeepStrictEqual(duplicate.answer, input.answer)) {
        throw new MistakeReviewError(409, "REVIEW_CONFLICT", "같은 요청 번호로 다른 복습 답안을 저장할 수 없어요.");
      }
      return { result: { eventId: duplicate.id, questionIndex: duplicate.questionIndex, answer: duplicate.answer, outcome: duplicate.outcome, attemptNumber: duplicate.attemptNumber }, replayed: true, points: 0 as const };
    }
    const [previous] = await tx.select({ attempt: reviews.attemptNumber }).from(reviews)
      .where(and(eq(reviews.setId, set.id), eq(reviews.questionIndex, input.questionIndex))).orderBy(desc(reviews.attemptNumber)).limit(1);
    const [result] = await tx.insert(reviews).values({ id: input.eventId, setId: set.id, questionIndex: input.questionIndex,
      answer: input.answer, outcome, attemptNumber: (previous?.attempt ?? 0) + 1 }).onConflictDoNothing().returning(resultColumns);
    if (!result) throw new MistakeReviewError(409, "REVIEW_CONFLICT", "요청 번호가 중복됐어요. 오답 목록을 다시 열어 주세요.");
    // Deliberately no ledger write: reviewing cannot override original XP eligibility.
    return { result, replayed: false, points: 0 as const };
  });
}
