import type { RequestHandler } from "express";
import * as permissions from "../services/permissions.service";
import { forbidden } from "../lib/errors";

/** Gate for the Collections workspace + the personal "follow" affordance:
 *  students + lecturers only (admins are read-only in Prep Hub). */
export const requireCollectionsAccess: RequestHandler = (req, _res, next) => {
  if (!permissions.canUseCollections(req.authUser)) {
    return next(forbidden("Collections are not available for your account"));
  }
  next();
};
