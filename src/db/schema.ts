import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const appUsers = pgTable("app_users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  email: varchar("email", { length: 320 }).unique(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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

export type TranslationSessionRow = typeof translationSessions.$inferSelect;
export type TranslationVariantRow = typeof translationVariants.$inferSelect;
