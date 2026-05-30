import type { RequestHandler } from "express";
import * as permissions from "../services/permissions.service";
import { forbidden } from "../lib/errors";

/** Admin-only gate (mirrors requireCollectionsAccess). */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!permissions.isAdmin(req.authUser)) {
    return next(forbidden("This action requires an administrator account"));
  }
  next();
};
