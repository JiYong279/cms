ALTER TABLE "posts" ADD COLUMN "planned_for" date;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_assignee_idx" ON "posts" USING btree ("assignee_id");