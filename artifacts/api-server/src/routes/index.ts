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
import workflowsRouter from "./workflows";
import featuresRouter from "./features";
import notificationsRouter from "./notifications";
import opportunitiesRouter from "./opportunities";
import bidsRouter from "./bids";
import submittalsRouter from "./submittals";
import estimatesRouter from "./estimates";
import proposalsRouter from "./proposals";
import projectControlsRouter from "./project-controls";
import subcontractorComplianceRouter from "./subcontractor-compliance";
import supplierOrdersRouter from "./supplier-orders";
import itbIntakesRouter from "./itb-intakes";
import platformProvisioningRouter from "./platform-provisioning";
import { dispatchToEnvironmentRuntime } from "../middlewares/executionDispatch";
import { requireSignedRuntimeContext } from "../middlewares/runtimeContext";

const router: IRouter = Router();
const billingRouter = process.env.RUNTIME_ENVIRONMENT_ID
  ? undefined
  : (await import("./billing")).default;

router.use(healthRouter);
if (process.env.RUNTIME_ENVIRONMENT_ID) {
  router.use(requireSignedRuntimeContext);
  router.use(featuresRouter);
  router.use(notificationsRouter);
  router.use(opportunitiesRouter);
  router.use(bidsRouter);
  router.use(submittalsRouter);
  router.use(estimatesRouter);
  router.use(proposalsRouter);
  router.use(workflowsRouter);
  router.use(integrationsRouter);
  router.use(projectsRouter);
  router.use(projectControlsRouter);
  router.use(subcontractorComplianceRouter);
  router.use(supplierOrdersRouter);
  router.use(itbIntakesRouter);
} else {
  router.use("/tenant/invitations/token", invitationTokenRouter);
  router.use(requireAuthenticatedUser);
  router.use(platformRouter);
  router.use(platformProvisioningRouter);
  if (billingRouter) router.use(billingRouter);
  router.use(requireTenantContext);
  router.use(tenantRouter);
  router.use(dispatchToEnvironmentRuntime);
  router.use(featuresRouter);
  router.use(notificationsRouter);
  router.use(opportunitiesRouter);
  router.use(bidsRouter);
  router.use(submittalsRouter);
  router.use(estimatesRouter);
  router.use(proposalsRouter);
  router.use(tenantAdminRouter);
  router.use(workflowsRouter);
  router.use(integrationsRouter);
  router.use(customersRouter);
  router.use(projectsRouter);
  router.use(projectControlsRouter);
  router.use(subcontractorComplianceRouter);
  router.use(supplierOrdersRouter);
  router.use(itbIntakesRouter);
}

export default router;
