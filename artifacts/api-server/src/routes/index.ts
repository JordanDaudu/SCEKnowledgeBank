import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import documentsRouter from "./documents";
import commentsRouter from "./comments";
import requestsRouter from "./requests";
import taxonomyRouter from "./taxonomy";
import usersRouter from "./users";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(documentsRouter);
router.use(commentsRouter);
router.use(requestsRouter);
router.use(taxonomyRouter);
router.use(usersRouter);
router.use(storageRouter);

export default router;
