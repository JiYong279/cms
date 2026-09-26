ALTER TABLE "users" ADD COLUMN "job_titles" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bios" jsonb DEFAULT '{}'::jsonb NOT NULL;