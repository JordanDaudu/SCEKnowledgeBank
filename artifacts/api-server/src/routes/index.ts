import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import documentsRouter from "./documents";
import commentsRouter from "./comments";
import reactionsRouter from "./reactions";
import favoritesRouter from "./favorites";
import requestsRouter from "./requests";
import taxonomyRouter from "./taxonomy";
import usersRouter from "./users";
import storageRouter from "./storage";
import notificationsRouter from "./notifications";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(documentsRouter);
router.use(commentsRouter);
router.use(reactionsRouter);
router.use(favoritesRouter);
router.use(requestsRouter);
router.use(taxonomyRouter);
router.use(usersRouter);
router.use(storageRouter);
router.use(notificationsRouter);
router.use(analyticsRouter);

export default router;
