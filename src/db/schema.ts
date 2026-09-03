import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const appUsers = pgTable(
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

export const translationSessions = pgTable(
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

export const translationVariants = pgTable(
  "translation_variants",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("session_id", { length: 36 })
      .notNull()
      .references(() => translationSessions.id, { onDelete: "cascade" }),
    tone: varchar("tone", { length: 20 }).notNull(),
    translatedText: text("translated_text").notNull(),
    transliteration: text("transliteration"),
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

export const savedPhrases = pgTable(
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

export const studyProgress = pgTable(
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

export const studyReviewEvents = pgTable(
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

export type TranslationSessionRow = typeof translationSessions.$inferSelect;
export type TranslationVariantRow = typeof translationVariants.$inferSelect;
