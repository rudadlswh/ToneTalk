CREATE TABLE "app_users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"email" varchar(320),
	"display_name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "saved_phrases" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"variant_id" varchar(36) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"source_text" text NOT NULL,
	"source_language" varchar(16) NOT NULL,
	"target_language" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'complete' NOT NULL,
	"model" varchar(120) NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_variants" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"session_id" varchar(36) NOT NULL,
	"tone" varchar(20) NOT NULL,
	"translated_text" text NOT NULL,
	"transliteration" text,
	"context_note" varchar(240) NOT NULL,
	"warning" varchar(240),
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_phrases" ADD CONSTRAINT "saved_phrases_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_phrases" ADD CONSTRAINT "saved_phrases_variant_id_translation_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."translation_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_sessions" ADD CONSTRAINT "translation_sessions_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_variants" ADD CONSTRAINT "translation_variants_session_id_translation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."translation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_phrases_owner_variant_uidx" ON "saved_phrases" USING btree ("owner_id","variant_id");--> statement-breakpoint
CREATE INDEX "saved_phrases_owner_created_idx" ON "saved_phrases" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "translation_sessions_owner_created_idx" ON "translation_sessions" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "translation_variants_session_tone_uidx" ON "translation_variants" USING btree ("session_id","tone");--> statement-breakpoint
CREATE INDEX "translation_variants_session_position_idx" ON "translation_variants" USING btree ("session_id","position");