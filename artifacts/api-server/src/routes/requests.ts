import { Router, type IRouter } from "express";
import {
  CreateRequestBody,
  ListRequestsQueryParams,
  UpdateRequestBody,
  UpdateRequestParams,
  VoteRequestParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import * as requestsService from "../services/requests.service";

const router: IRouter = Router();

router.get("/requests", requireAuth, async (req, res, next) => {
  try {
    const q = ListRequestsQueryParams.parse(req.query);
    const filters: { status?: string; courseId?: string } = {};
    if (q.status) filters.status = q.status;
    if (q.courseId) filters.courseId = q.courseId;
    const list = await requestsService.listRequests(filters, req.authUser!);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/requests", requireAuth, async (req, res, next) => {
  try {
    const body = CreateRequestBody.parse(req.body);
    const input: { title: string; description?: string; courseId?: string } = {
      title: body.title,
    };
    if (body.description !== undefined) input.description = body.description;
    if (body.courseId) input.courseId = body.courseId;
    const dto = await requestsService.createRequest(input, req.authUser!);
    res.status(201).json(dto);
  } catch (err) {
    next(err);
  }
});

router.patch("/requests/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = UpdateRequestParams.parse(req.params);
    const body = UpdateRequestBody.parse(req.body);
    const dto = await requestsService.updateRequest(id, body, req.authUser!);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

router.post("/requests/:id/vote", requireAuth, async (req, res, next) => {
  try {
    const { id } = VoteRequestParams.parse(req.params);
    const dto = await requestsService.voteOnRequest(id, req.authUser!);
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

export default router;
