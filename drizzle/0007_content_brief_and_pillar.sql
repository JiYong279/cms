ALTER TABLE "posts" ADD COLUMN "pillar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "content_brief" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "posts_per_week" integer;