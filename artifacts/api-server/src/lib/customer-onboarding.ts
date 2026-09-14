import {
  db,
  environmentsTable,
  tenantBusinessTypesTable,
  tenantsTable,
  type TenantBusinessType,
} from "@workspace/db";
import { ensurePublishedWorkflow, type WorkflowExecutor } from "./workflow";

export type CustomerWorkspaceInput = {
  name: string;
  slug: string;
  businessTypes: TenantBusinessType[];
};

export type InitializeCustomerWorkflow = (
  tenantId: number,
  environmentId: number,
  userId: number | undefined,
  executor: WorkflowExecutor,
) => Promise<unknown>;

export async function createCustomerWorkspace(
  input: CustomerWorkspaceInput,
  userId: number | undefined,
  initializeWorkflow: InitializeCustomerWorkflow = (tenantId, environmentId, workflowUserId, executor) =>
    ensurePublishedWorkflow(tenantId, environmentId, workflowUserId, executor),
) {
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenantsTable)
      .values({ name: input.name, slug: input.slug, status: "active" })
      .returning();

    await tx.insert(tenantBusinessTypesTable).values(
      input.businessTypes.map((businessType) => ({ tenantId: tenant.id, businessType })),
    );

    const environments = await tx
      .insert(environmentsTable)
      .values([
        {
          tenantId: tenant.id,
          name: "Development / Test / Demo",
          slug: "dtd",
          kind: "dtd",
          status: "active",
        },
        {
          tenantId: tenant.id,
          name: "Production",
          slug: "production",
          kind: "production",
          status: "active",
        },
      ])
      .returning({ id: environmentsTable.id });

    for (const environment of environments) {
      await initializeWorkflow(tenant.id, environment.id, userId, tx);
    }

    return { tenant, environments };
  });
}