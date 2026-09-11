import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import { requireTenantContext } from "../middlewares/tenantContext";
import tenantRouter from "./tenant";
import integrationsRouter from "./integrations";
import tenantAdminRouter from "./tenant-admin";
import invitationTokenRouter from "./invitation-token";
import platformRouter from "./platform";
import customersRouter from "./customers";
import { requireAuthenticatedUser } from "../middlewares/tenantContext";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/tenant/invitations/token", invitationTokenRouter);
router.use(requireAuthenticatedUser);
router.use(platformRouter);
router.use(requireTenantContext);
router.use(tenantRouter);
router.use(tenantAdminRouter);
router.use(integrationsRouter);
router.use(customersRouter);
router.use(projectsRouter);

export default router;
