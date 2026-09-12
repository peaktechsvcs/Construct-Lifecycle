import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, platformFeatureFlagsTable } from "@workspace/db";
import { ListFeatureFlagsResponse } from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { FEATURE_CATALOG } from "../lib/feature-catalog";

const router: IRouter = Router();

router.get("/features", async (req: TenantRequest, res): Promise<void> => {
  const flags = await db.select().from(platformFeatureFlagsTable);
  const enabledKeys = new Set(flags.filter((flag) => flag.enabled).map((flag) => flag.key));
  const visible = FEATURE_CATALOG
    .filter((feature) => req.isPlatformAdmin || enabledKeys.has(feature.key))
    .map((feature) => ({
      ...feature,
      enabled: enabledKeys.has(feature.key),
    }));
  res.json(ListFeatureFlagsResponse.parse(visible));
});

export default router;