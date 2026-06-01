import { Router, type IRouter } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { badRequest, forbidden } from "../lib/errors";
import { loadAuthenticatedUser } from "../services/auth.service";
import * as profileService from "../services/profile.service";
import * as avatarService from "../services/avatar.service";
import * as auditService from "../services/audit.service";
import { currentUserDto } from "../lib/current-user-dto";
import { forbiddenProfileKey, auditActionForForbiddenKey } from "../lib/profile-guard";

const router: IRouter = Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const UsernameQuery = z.object({ username: z.string().min(1).max(60) });
const ProfilePatchBody = z.object({ username: z.string().min(1).max(60) }).strict();
const AvatarParams = z.object({ id: z.string().uuid() });

router.get("/me/username-available", requireAuth, async (req, res, next) => {
  try {
    const { username } = UsernameQuery.parse(req.query);
    res.json(await profileService.checkUsernameAvailability(req.authUser!, username));
  } catch (err) {
    next(err);
  }
});

router.patch("/me/profile", requireAuth, async (req, res, next) => {
  try {
    const user = req.authUser!;
    const bad = forbiddenProfileKey((req.body ?? {}) as Record<string, unknown>);
    if (bad) {
      await auditService.record(user.id, auditActionForForbiddenKey(bad), "user", user.id, { attempted: bad });
      return next(forbidden("You are not allowed to change that field."));
    }
    const body = ProfilePatchBody.parse(req.body);
    await profileService.updateUsername(user, body.username);
    const fresh = await loadAuthenticatedUser(user.id);
    res.json(currentUserDto(fresh!));
  } catch (err) {
    next(err);
  }
});

router.put("/me/avatar", requireAuth, avatarUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return next(badRequest("No file uploaded.", { errorCode: "avatar_missing" }));
    await avatarService.setAvatar(req.authUser!, {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    const fresh = await loadAuthenticatedUser(req.authUser!.id);
    res.json(currentUserDto(fresh!));
  } catch (err) {
    next(err);
  }
});

router.delete("/me/avatar", requireAuth, async (req, res, next) => {
  try {
    await avatarService.removeAvatar(req.authUser!);
    const fresh = await loadAuthenticatedUser(req.authUser!.id);
    res.json(currentUserDto(fresh!));
  } catch (err) {
    next(err);
  }
});

router.get("/users/:id/avatar", requireAuth, async (req, res, next) => {
  try {
    const { id } = AvatarParams.parse(req.params);
    await avatarService.streamAvatar(id, res);
  } catch (err) {
    next(err);
  }
});

export default router;
