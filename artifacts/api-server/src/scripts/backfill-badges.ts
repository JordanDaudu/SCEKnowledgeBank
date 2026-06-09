/**
 * One-time (idempotent) badge backfill. Reputation scores are derived from
 * current state and need no backfill, but badges are stored rows — this grants
 * historical achievements to existing users. Safe to re-run: evaluateBadges
 * inserts with skipDuplicates and never deletes.
 *
 * Run directly:  tsx src/scripts/backfill-badges.ts
 * Or import and call backfillBadges() (the demo seed does this).
 */
import { db } from "@workspace/db";
import { evaluateBadges } from "../services/reputation.service";

export async function backfillBadges(): Promise<number> {
  const users = await db.user.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  for (const u of users) {
    await evaluateBadges(u.id);
  }
  return users.length;
}

// Direct-run guard (tsx). Compares the resolved module URL to argv[1].
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  backfillBadges()
    .then((n) => {
      // eslint-disable-next-line no-console
      console.log(`Backfilled badges for ${n} users`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("badge backfill failed", err);
      process.exit(1);
    });
}
