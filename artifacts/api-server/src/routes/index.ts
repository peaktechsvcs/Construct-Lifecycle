import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import { requireTenantContext } from "../middlewares/tenantContext";
import tenantRouter from "./tenant";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireTenantContext);
router.use(tenantRouter);
router.use(projectsRouter);

export default router;
