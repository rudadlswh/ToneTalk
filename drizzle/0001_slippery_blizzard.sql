CREATE TABLE "study_progress" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"saved_phrase_id" varchar(36) NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"ease_percent" integer DEFAULT 250 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"next_review_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_review_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"owner_id" varchar(64) NOT NULL,
	"saved_phrase_id" varchar(36) NOT NULL,
	"rating" varchar(12) NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "default_target_language" varchar(16) DEFAULT 'ja' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "daily_study_goal" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "study_progress" ADD CONSTRAINT "study_progress_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_progress" ADD CONSTRAINT "study_progress_saved_phrase_id_saved_phrases_id_fk" FOREIGN KEY ("saved_phrase_id") REFERENCES "public"."saved_phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_review_events" ADD CONSTRAINT "study_review_events_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_review_events" ADD CONSTRAINT "study_review_events_saved_phrase_id_saved_phrases_id_fk" FOREIGN KEY ("saved_phrase_id") REFERENCES "public"."saved_phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_progress_saved_phrase_uidx" ON "study_progress" USING btree ("saved_phrase_id");--> statement-breakpoint
CREATE INDEX "study_progress_owner_due_idx" ON "study_progress" USING btree ("owner_id","next_review_at");--> statement-breakpoint
CREATE INDEX "study_review_events_owner_reviewed_idx" ON "study_review_events" USING btree ("owner_id","reviewed_at");