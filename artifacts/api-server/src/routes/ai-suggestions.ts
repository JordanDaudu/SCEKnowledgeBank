import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { aiGenerateRateLimiter } from "../middlewares/rate-limit";
import * as aiSuggestionsService from "../services/ai-suggestions.service";
import { AiSuggestionError } from "../services/ai-suggestions.service";

const router: IRouter = Router();

const IdParams = z.object({ id: z.string().uuid() });

const AcceptBody = z.object({
  acceptSummary: z.boolean(),
  tagIds: z.array(z.string().uuid()).max(5).default([]),
  newTags: z.array(z.string().min(1).max(64)).max(3).default([]),
});

/** Map service error codes to HTTP statuses. */
function statusFor(err: AiSuggestionError): number {
  switch (err.code) {
    case "forbidden":
      return 403;
    case "not_found":
    case "no_suggestion":
      return 404;
    case "not_pending":
      return 409;
    case "no_extracted_text":
    case "ai_disabled":
      return 422;
  }
}

router.get(
  "/documents/:id/ai-suggestions",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const result = await aiSuggestionsService.getForDocument(
        id,
        req.authUser!,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AiSuggestionError) {
        res
          .status(statusFor(err))
          .json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  },
);

router.post(
  "/documents/:id/ai-suggestions/accept",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const body = AcceptBody.parse(req.body);
      const result = await aiSuggestionsService.accept(
        id,
        req.authUser!,
        body,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AiSuggestionError) {
        res
          .status(statusFor(err))
          .json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  },
);

router.post(
  "/documents/:id/ai-suggestions/dismiss",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const result = await aiSuggestionsService.dismiss(id, req.authUser!);
      res.json(result);
    } catch (err) {
      if (err instanceof AiSuggestionError) {
        res
          .status(statusFor(err))
          .json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  },
);

router.post(
  "/documents/:id/ai-suggestions/generate",
  requireAuth,
  aiGenerateRateLimiter,
  async (req, res, next) => {
    try {
      const { id } = IdParams.parse(req.params);
      const result = await aiSuggestionsService.generateViaApi(
        id,
        req.authUser!,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AiSuggestionError) {
        res
          .status(statusFor(err))
          .json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  },
);

export default router;
