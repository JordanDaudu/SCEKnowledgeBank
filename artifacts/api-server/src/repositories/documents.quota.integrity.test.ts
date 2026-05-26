import { describe, expect, it } from "vitest";

// Regression for the restore+delete quota-bypass loophole (US-10).
// The bug was: softDeleteDocumentAndReleaseQuota summed every
// DocumentFile.sizeBytes for the doc, including restore rows that
// were never billed (they share an existing storage blob). Across
// multiple restore cycles you could over-credit your users.usedBytes
// and zero out usage that real other documents were still occupying.
//
// The fix routes only "countedTowardQuota = true" rows into the
// release sum. This test asserts the Prisma WHERE filter the helper
// uses, so the integrity contract is locked in at the SQL level
// without needing a live database.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoSource = readFileSync(
  join(__dirname, "documents.repo.ts"),
  "utf8",
);

describe("softDeleteDocumentAndReleaseQuota — quota integrity", () => {
  it("releases only bytes from rows that were billed on insert", () => {
    // Find the relevant block by anchor comment.
    const idx = repoSource.indexOf("softDeleteDocumentAndReleaseQuota");
    expect(idx).toBeGreaterThan(-1);
    const block = repoSource.slice(idx, idx + 1500);
    // The Prisma query inside this helper MUST filter by
    // countedTowardQuota: true. Without it, restore rows
    // (countedTowardQuota=false) would be released and you could
    // bypass quota by uploading→restoring→deleting.
    expect(block).toMatch(/countedTowardQuota:\s*true/);
  });

  it("insertNewVersionFile persists the countTowardQuota flag onto the row", () => {
    const idx = repoSource.indexOf("export async function insertNewVersionFile");
    expect(idx).toBeGreaterThan(-1);
    const block = repoSource.slice(idx, idx + 2000);
    // The new row's countedTowardQuota column must mirror the
    // countTowardQuota arg, otherwise the integrity check above
    // can't tell restore rows apart from real upload rows.
    expect(block).toMatch(/countedTowardQuota:\s*countTowardQuota/);
  });
});
