/**
 * One-time (idempotent) backfill of extracted text for PDFs that were
 * uploaded while the bundled server extracted every PDF to 0 chars (fixed in
 * commit aa0662a by externalizing pdf-parse). Those rows kept NULL
 * `extractedText`, which suppressed the AI-suggestions card on every affected
 * PDF.
 *
 * For each PDF DocumentFile missing extracted text, this re-reads the stored
 * file, runs the (now-working) extractor, and writes back the text-derived
 * columns — exactly the subset the upload path persists. It NEVER calls
 * Gemini: once text exists, the AI card shows a "Generate" button the owner
 * can click. Scanned/no-text PDFs are left as-is and reported as skipped.
 *
 * Safe to re-run: it only touches PDFs that still have no text.
 *
 * Run:  pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-pdf-text.ts
 */
import { db } from "@workspace/db";
import { getStorage } from "../lib/storage";
import { extractMetadata } from "../services/documents/metadata.service";
import { logger } from "../lib/logger";

export interface BackfillPdfTextResult {
  candidates: number;
  updated: number;
  skippedNoText: number;
  errors: number;
}

export async function backfillPdfText(): Promise<BackfillPdfTextResult> {
  const storage = getStorage();
  const files = await db.documentFile.findMany({
    where: {
      mimeType: "application/pdf",
      OR: [{ extractedText: null }, { extractedText: "" }],
    },
    select: { id: true, storagePath: true, originalFilename: true },
  });

  const result: BackfillPdfTextResult = {
    candidates: files.length,
    updated: 0,
    skippedNoText: 0,
    errors: 0,
  };

  for (const f of files) {
    try {
      const buffer = await storage.get(f.storagePath);
      const meta = await extractMetadata({
        buffer,
        mimeType: "application/pdf",
        filename: f.originalFilename,
      });
      const text = meta.extractedText?.trim();
      if (!text) {
        // Genuinely no text layer (e.g. a scanned PDF) — nothing to store.
        result.skippedNoText += 1;
        continue;
      }
      await db.documentFile.update({
        where: { id: f.id },
        data: {
          extractedText: meta.extractedText ?? null,
          pageCount: meta.pageCount ?? null,
          detectedTitle: meta.detectedTitle ?? null,
          author: meta.author ?? null,
          language: meta.language ?? null,
          keywords: meta.keywords ?? [],
        },
      });
      result.updated += 1;
    } catch (err) {
      result.errors += 1;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), fileId: f.id },
        "pdf text backfill failed for file",
      );
    }
  }
  return result;
}

// Direct-run guard (tsx). Mirrors backfill-badges.ts.
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  backfillPdfText()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(
        `PDF text backfill complete: ${r.updated} updated, ${r.skippedNoText} skipped (no text layer), ${r.errors} errors, of ${r.candidates} candidates.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("pdf text backfill failed", err);
      process.exit(1);
    });
}
