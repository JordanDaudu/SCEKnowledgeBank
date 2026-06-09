-- Earned gamification achievements (reputation badges). Definitions live in
-- application code; only awarded rows are persisted. The unique index makes
-- badge awarding idempotent.
CREATE TABLE "user_badges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "badge_key" TEXT NOT NULL,
  "awarded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_badges_user_key_unique" ON "user_badges" ("user_id", "badge_key");
CREATE INDEX "user_badges_user_idx" ON "user_badges" ("user_id");

ALTER TABLE "user_badges"
  ADD CONSTRAINT "user_badges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
