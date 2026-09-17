import { sql } from "drizzle-orm";
import type { StudyPointActivity } from "@/lib/study-points";
import type { DailyAnswer, DailyKind, DailyResult, PracticeSource } from "@/lib/daily-ai-practice";
import type { PracticePhrase } from "@/lib/study-practice";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const databaseSchemaName = process.env.DATABASE_SCHEMA ?? "tonetalk_dev";

if (databaseSchemaName !== "tonetalk_dev" && databaseSchemaName !== "tonetalk_prod") {
  throw new Error("DATABASE_SCHEMA must be tonetalk_dev or tonetalk_prod");
}

const databaseSchema = pgSchema(databaseSchemaName);

export const appUsers = databaseSchema.table(
  "app_users",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    email: varchar("email", { length: 320 }).unique(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    defaultTargetLanguage: varchar("default_target_language", { length: 16 })
      .default("ja")
      .notNull(),
    dailyStudyGoal: integer("daily_study_goal").default(10).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "app_users_default_target_language_check",
      sql`${table.defaultTargetLanguage} in ('en', 'ja', 'ko', 'fr', 'es', 'zh-CN', 'de')`,
    ),
    check(
      "app_users_daily_study_goal_check",
      sql`${table.dailyStudyGoal} between 1 and 100`,
    ),
  ],
);

export const translationSessions = databaseSchema.table(
  "translation_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerId: varchar("owner_id", { length: 64 })
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    sourceText: text("source_text").notNull(),
    sourceLanguage: varchar("source_language", { length: 16 }).notNull(),
    targetLanguage: varchar("target_language", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("complete"),
    model: varchar("model", { length: 120 }).notNull(),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("translation_sessions_owner_created_idx").on(
      table.ownerId,
      table.createdAt,
    ),
  ],
);

export const translationVariants = databaseSchema.table(
  "translation_variants",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("session_id", { length: 36 })
      .notNull()
      .references(() => translationSessions.id, { onDelete: "cascade" }),
    tone: varchar("tone", { length: 20 }).notNull(),
    translatedText: text("translated_text").notNull(),
    transliteration: text("transliteration"),
    hangulPronunciation: text("hangul_pronunciation"),
    contextNote: varchar("context_note", { length: 240 }).notNull(),
    warning: varchar("warning", { length: 240 }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("translation_variants_session_tone_uidx").on(
      table.sessionId,
      table.tone,
    ),
    index("translation_variants_session_position_idx").on(
      table.sessionId,
      table.position,
    ),
  ],
);

export const savedPhrases = databaseSchema.table(
  "saved_phrases",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerId: varchar("owner_id", { length: 64 })
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    variantId: varchar("variant_id", { length: 36 })
      .notNull()
      .references(() => translationVariants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("saved_phrases_owner_variant_uidx").on(
      table.ownerId,
      table.variantId,
    ),
    index("saved_phrases_owner_created_idx").on(
      table.ownerId,
      table.createdAt,
    ),
  ],
);

export const studyProgress = databaseSchema.table(
  "study_progress",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerId: varchar("owner_id", { length: 64 })
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    savedPhraseId: varchar("saved_phrase_id", { length: 36 })
      .notNull()
      .references(() => savedPhrases.id, { onDelete: "cascade" }),
    repetitions: integer("repetitions").default(0).notNull(),
    intervalDays: integer("interval_days").default(0).notNull(),
    easePercent: integer("ease_percent").default(250).notNull(),
    reviewCount: integer("review_count").default(0).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("study_progress_saved_phrase_uidx").on(table.savedPhraseId),
    index("study_progress_owner_due_idx").on(
      table.ownerId,
      table.nextReviewAt,
    ),
    check(
      "study_progress_schedule_values_check",
      sql`${table.repetitions} >= 0 and ${table.intervalDays} >= 0 and ${table.reviewCount} >= 0 and ${table.easePercent} between 130 and 300`,
    ),
  ],
);

export const studyReviewEvents = databaseSchema.table(
  "study_review_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ownerId: varchar("owner_id", { length: 64 })
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    savedPhraseId: varchar("saved_phrase_id", { length: 36 })
      .notNull()
      .references(() => savedPhrases.id, { onDelete: "cascade" }),
    rating: varchar("rating", { length: 12 }).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("study_review_events_owner_reviewed_idx").on(
      table.ownerId,
      table.reviewedAt,
    ),
    index("study_review_events_saved_phrase_idx").on(table.savedPhraseId),
    check(
      "study_review_events_rating_check",
      sql`${table.rating} in ('again', 'hard', 'good', 'easy')`,
    ),
  ],
);

// Append-only learning XP ledger. Retry IDs and daily uniqueness are enforced
// by PostgreSQL, including concurrent requests from different app instances.
export const studyPointEvents = databaseSchema.table("study_point_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 64 }).notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  activity: varchar("activity", { length: 12 }).$type<StudyPointActivity>().notNull(),
  activityId: varchar("activity_id", { length: 240 }).notNull(),
  rewardDay: integer("reward_day").notNull(),
  // DB clock, not the browser or question-set day. NULL is legacy history only.
  creditedOn: date("credited_on").default(sql`(now() AT TIME ZONE 'Asia/Seoul')::date`),
  points: integer("points").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("study_point_events_completion_uidx").on(table.ownerId, table.activity, table.activityId, table.rewardDay),
  uniqueIndex("study_point_events_daily_uidx").on(table.ownerId, table.activity, table.creditedOn),
  index("study_point_events_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  check("study_point_events_reward_check", sql`(${table.activity} = 'quiz' and ${table.points} = 20 and ${table.rewardDay} > 0)
    or (${table.activity} = 'puzzle' and ${table.points} = 25 and ${table.rewardDay} > 0)
    or (${table.activity} = 'chat' and ${table.points} = 35 and ${table.rewardDay} = 0)`),
]);

// One canonical set per account/KST day/activity/source. A short lease fences generation
// without holding a connection/transaction while the AI provider responds.
export const dailyPracticeSets = databaseSchema.table("daily_practice_sets", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 64 }).notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  day: integer("day").notNull(),
  kind: varchar("kind", { length: 12 }).$type<DailyKind>().notNull(),
  source: varchar("source", { length: 12 }).$type<PracticeSource>().default("daily").notNull(),
  phrases: jsonb("phrases").$type<PracticePhrase[]>(),
  generationToken: varchar("generation_token", { length: 36 }),
  generationExpiresAt: timestamp("generation_expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex("daily_practice_sets_owner_day_kind_source_uidx").on(table.ownerId, table.day, table.kind, table.source),
  check("daily_practice_sets_kind_day_check", sql`${table.kind} in ('quiz', 'puzzle') and ${table.day} > 0`),
  check("daily_practice_sets_source_check", sql`${table.source} in ('daily', 'saved')`),
  check("daily_practice_sets_phrases_check", sql`${table.phrases} is null or (jsonb_typeof(${table.phrases}) = 'array' and jsonb_array_length(${table.phrases}) between 1 and 5 and (${table.source} = 'saved' or jsonb_array_length(${table.phrases}) = 5))`),
]);

// No conversation text: only server-confirmed progress and transcript digests.
export const studyChatSessions = databaseSchema.table("study_chat_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 64 }).notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  scenario: varchar("scenario", { length: 12 }).notNull(),
  language: varchar("language", { length: 10 }).notNull(),
  turns: integer("turns").notNull().default(0),
  transcriptHash: varchar("transcript_hash", { length: 64 }).notNull(),
  lastEventId: varchar("last_event_id", { length: 36 }),
  lastRequestHash: varchar("last_request_hash", { length: 64 }),
  generationToken: varchar("generation_token", { length: 36 }),
  generationExpiresAt: timestamp("generation_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index("study_chat_sessions_owner_created_idx").on(table.ownerId, table.createdAt),
  check("study_chat_sessions_turns_check", sql`${table.turns} between 0 and 4`),
]);

export const dailyPracticeAnswers = databaseSchema.table("daily_practice_answers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  setId: varchar("set_id", { length: 36 }).notNull().references(() => dailyPracticeSets.id, { onDelete: "cascade" }),
  questionIndex: integer("question_index").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  answer: jsonb("answer").$type<DailyAnswer>().notNull(),
  outcome: varchar("outcome", { length: 12 }).$type<DailyResult["outcome"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, table => [
  uniqueIndex("daily_practice_answers_question_attempt_uidx").on(table.setId, table.questionIndex, table.attemptNumber),
  check("daily_practice_answers_values_check", sql`${table.questionIndex} between 0 and 4 and ${table.attemptNumber} > 0 and ${table.outcome} in ('correct', 'wrong', 'revealed')`),
]);

// Server-only runtime data; see supabase/migrations/*_performance_runtime.sql
// for the additive migration and explicit RLS/revocations in both environments.
export const inferenceLeases = databaseSchema.table("inference_leases", {
  id: varchar("id", { length: 40 }).primaryKey(),
  token: varchar("token", { length: 36 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Review attempts never replace the original first-choice/reveal evidence or award XP.
export const mistakeReviewAnswers = databaseSchema.table("mistake_review_answers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  setId: varchar("set_id", { length: 36 }).notNull().references(() => dailyPracticeSets.id, { onDelete: "cascade" }),
  questionIndex: integer("question_index").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  answer: jsonb("answer").$type<DailyAnswer>().notNull(),
  outcome: varchar("outcome", { length: 12 }).$type<DailyResult["outcome"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, table => [
  uniqueIndex("mistake_review_answers_question_attempt_uidx").on(table.setId, table.questionIndex, table.attemptNumber),
  check("mistake_review_answers_values_check", sql`${table.questionIndex} between 0 and 4 and ${table.attemptNumber} > 0 and ${table.outcome} in ('correct', 'wrong', 'revealed')`),
]);
// Server-only current counters (not prompts, tokens or an unbounded event log).
export const aiUsageState = databaseSchema.table("ai_usage_state", {
  id: varchar("id", { length: 160 }).primaryKey(),
  minute: integer("minute").notNull().default(0),
  day: integer("day").notNull().default(0),
  minuteCalls: integer("minute_calls").notNull().default(0),
  dayCalls: integer("day_calls").notNull().default(0),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  blockCode: varchar("block_code", { length: 40 }),
}, table => [check("ai_usage_state_counts_check", sql`${table.minuteCalls} >= 0 and ${table.dayCalls} >= 0`)]);
export const translationCache = databaseSchema.table("translation_cache", {
  key: varchar("key", { length: 64 }).primaryKey(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("translation_cache_expires_idx").on(table.expiresAt)]);
