import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import * as favoritesService from "../services/favorites.service";

const router: IRouter = Router();

const FavoriteParams = z.object({ id: z.string().uuid() });

router.post(
  "/documents/:id/favorite",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = FavoriteParams.parse(req.params);
      const status = await favoritesService.favoriteDocument(id, req.authUser!);
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/documents/:id/favorite",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = FavoriteParams.parse(req.params);
      const status = await favoritesService.unfavoriteDocument(
        id,
        req.authUser!,
      );
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/me/favorites", requireAuth, async (req, res, next) => {
  try {
    const items = await favoritesService.listFavoritesForUser(req.authUser!);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

export default router;
