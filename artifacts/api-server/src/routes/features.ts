import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  featureFeedbackVotesTable,
  platformFeatureFlagsTable,
  TENANT_BUSINESS_TYPES,
} from "@workspace/db";
import {
  ListFeatureFeedbackResponse,
  ListFeatureFlagsResponse,
  UpdateFeatureFlagBody,
  UpdateFeatureFlagParams,
  UpdateFeatureFlagResponse,
  VoteForFeatureBody,
  VoteForFeatureResponse,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { FEATURE_CATALOG, entitledFeatures } from "../lib/feature-catalog";
import { requirePlatformAdmin } from "../middlewares/platformAdmin";
import { getTenantBusinessTypes } from "../lib/tenant-business-profile";

const router: IRouter = Router();

async function enabledFeatureKeys() {
  const flags = await db.select().from(platformFeatureFlagsTable);
  return new Set(flags.filter((flag) => flag.enabled).map((flag) => flag.key));
}

async function listFeedback(req: TenantRequest) {
  if (!req.tenantId || !req.localUserId) return [];
  const enabledKeys = await enabledFeatureKeys();
  const businessTypes = await getTenantBusinessTypes(req.tenantId);
  const entitledKeys = new Set(entitledFeatures(businessTypes).map((feature) => feature.key));
  const voteCounts = await db
    .select({
      featureKey: featureFeedbackVotesTable.featureKey,
      voteCount: sql<number>`count(*)::int`,
    })
    .from(featureFeedbackVotesTable)
    .groupBy(featureFeedbackVotesTable.featureKey);
  const [currentVote] = await db
    .select({ featureKey: featureFeedbackVotesTable.featureKey })
    .from(featureFeedbackVotesTable)
    .where(and(
      eq(featureFeedbackVotesTable.tenantId, req.tenantId!),
      eq(featureFeedbackVotesTable.userId, req.localUserId!),
    ))
    .limit(1);
  const counts = new Map(voteCounts.map((vote) => [vote.featureKey, Number(vote.voteCount)]));

  return FEATURE_CATALOG
    .filter((feature) => entitledKeys.has(feature.key) && !enabledKeys.has(feature.key))
    .map((feature) => ({
      key: feature.key,
      label: feature.label,
      section: feature.section,
      description: feature.description,
      voteCount: counts.get(feature.key) ?? 0,
      votedByCurrentUser: currentVote?.featureKey === feature.key,
    }));
}

router.get("/features", async (req: TenantRequest, res): Promise<void> => {
  const enabledKeys = await enabledFeatureKeys();
  const businessTypes = req.isPlatformAdmin
    ? [...TENANT_BUSINESS_TYPES]
    : await getTenantBusinessTypes(req.tenantId!);
  const entitledKeys = new Set(entitledFeatures(businessTypes).map((feature) => feature.key));
  const visible = FEATURE_CATALOG
    .filter((feature) => req.isPlatformAdmin || (enabledKeys.has(feature.key) && entitledKeys.has(feature.key)))
    .map(({ businessTypes: _businessTypes, ...feature }) => ({
      ...feature,
      enabled: enabledKeys.has(feature.key),
    }));
  res.json(ListFeatureFlagsResponse.parse(visible));
});

router.patch("/platform/features/:featureKey", requirePlatformAdmin, async (req: TenantRequest, res): Promise<void> => {
  const params = UpdateFeatureFlagParams.safeParse(req.params);
  const body = UpdateFeatureFlagBody.safeParse(req.body);
  const feature = params.success ? FEATURE_CATALOG.find((item) => item.key === params.data.featureKey) : undefined;
  if (!params.success || !body.success || !feature) {
    res.status(400).json({ error: "Invalid feature flag" });
    return;
  }

  const [flag] = await db
    .insert(platformFeatureFlagsTable)
    .values({
      key: feature.key,
      enabled: body.data.enabled,
      updatedByUserId: req.localUserId!,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformFeatureFlagsTable.key,
      set: {
        enabled: body.data.enabled,
        updatedByUserId: req.localUserId!,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json(UpdateFeatureFlagResponse.parse({
    ...feature,
    enabled: flag.enabled,
  }));
});

router.get("/feedback/features", async (req: TenantRequest, res): Promise<void> => {
  res.json(ListFeatureFeedbackResponse.parse(await listFeedback(req)));
});

router.post("/feedback/vote", async (req: TenantRequest, res): Promise<void> => {
  if (!req.tenantId || !req.localUserId) {
    res.status(403).json({ error: "A tenant membership is required to vote" });
    return;
  }
  const parsed = VoteForFeatureBody.safeParse(req.body);
  const enabledKeys = await enabledFeatureKeys();
  const businessTypes = await getTenantBusinessTypes(req.tenantId);
  const entitledKeys = new Set(entitledFeatures(businessTypes).map((feature) => feature.key));
  const feature = parsed.success
    ? FEATURE_CATALOG.find((item) => item.key === parsed.data.featureKey)
    : undefined;
  if (!parsed.success || !feature || !entitledKeys.has(feature.key) || enabledKeys.has(feature.key)) {
    res.status(400).json({ error: "That feature is not available for voting" });
    return;
  }

  await db.insert(featureFeedbackVotesTable).values({
    featureKey: feature.key,
    tenantId: req.tenantId!,
    userId: req.localUserId!,
  }).onConflictDoUpdate({
    target: [featureFeedbackVotesTable.tenantId, featureFeedbackVotesTable.userId],
    set: {
      featureKey: feature.key,
      createdAt: new Date(),
    },
  });

  res.json(VoteForFeatureResponse.parse(await listFeedback(req)));
});

export default router;