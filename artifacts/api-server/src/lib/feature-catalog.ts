import type { TenantBusinessType } from "@workspace/db";

export type FeatureCatalogEntry = {
  key: string;
  label: string;
  section: string;
  description: string;
  route: string;
  businessTypes: TenantBusinessType[];
};

export const FEATURE_CATALOG: FeatureCatalogEntry[] = [
  { key: "contracts", label: "Contracts", section: "Projects", description: "Manage contract records, commitments, dates, and executed documents.", route: "/coming-soon/contracts", businessTypes: ["general-contractor", "subcontractor"] },
  { key: "milestones", label: "Milestones", section: "Projects", description: "Track dates and decisions that keep projects on plan.", route: "/coming-soon/milestones", businessTypes: ["general-contractor", "subcontractor"] },
  { key: "vendors", label: "Vendors", section: "Operations", description: "Maintain vendor relationships, contacts, and performance history.", route: "/coming-soon/vendors", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "products", label: "Products", section: "Operations", description: "Maintain products, materials, and assemblies used across projects.", route: "/coming-soon/products", businessTypes: ["supplier"] },
  { key: "selections", label: "Selections", section: "Operations", description: "Collect, approve, and coordinate customer and design selections.", route: "/coming-soon/selections", businessTypes: ["general-contractor", "subcontractor"] },
  { key: "procurement", label: "Procurement", section: "Operations", description: "Plan purchasing activity against project scope and timing.", route: "/coming-soon/procurement", businessTypes: ["general-contractor", "supplier"] },
  { key: "purchase-orders", label: "Purchase Orders", section: "Operations", description: "Create and track purchase orders from release through confirmation.", route: "/coming-soon/purchase-orders", businessTypes: ["general-contractor", "supplier"] },
  { key: "deliveries", label: "Deliveries", section: "Operations", description: "Coordinate delivery dates, shipments, and jobsite readiness.", route: "/coming-soon/deliveries", businessTypes: ["general-contractor", "supplier"] },
  { key: "receiving", label: "Receiving", section: "Operations", description: "Record what arrived, what is missing, and what needs resolution.", route: "/coming-soon/receiving", businessTypes: ["general-contractor", "supplier"] },
  { key: "revenue", label: "Revenue", section: "Financial", description: "Understand expected and realized revenue across the lifecycle.", route: "/coming-soon/revenue", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "commitments", label: "Commitments", section: "Financial", description: "Track committed spend and obligations before they become costs.", route: "/coming-soon/commitments", businessTypes: ["general-contractor"] },
  { key: "costs", label: "Costs", section: "Financial", description: "Capture project costs and compare actuals with the plan.", route: "/coming-soon/costs", businessTypes: ["general-contractor"] },
  { key: "billing", label: "Billing", section: "Financial", description: "Manage invoices, draws, collections, and billing status.", route: "/coming-soon/billing", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "change-orders", label: "Change Orders", section: "Financial", description: "Control scope, price, and schedule changes with an approval trail.", route: "/coming-soon/change-orders", businessTypes: ["general-contractor", "subcontractor"] },
  { key: "margin", label: "Margin", section: "Financial", description: "See project margin as scope, cost, and billing change.", route: "/coming-soon/margin", businessTypes: ["general-contractor"] },
  { key: "open-items", label: "Open Items", section: "Closeout", description: "Resolve punch-list items and open responsibilities before completion.", route: "/coming-soon/open-items", businessTypes: ["general-contractor", "subcontractor"] },
  { key: "documentation", label: "Documentation", section: "Closeout", description: "Collect closeout documents, warranties, and final records.", route: "/coming-soon/documentation", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "final-billing", label: "Final Billing", section: "Closeout", description: "Complete final billing and confirm the financial handoff.", route: "/coming-soon/final-billing", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "closed-projects", label: "Closed Projects", section: "Closeout", description: "Review completed projects and the history behind the work.", route: "/coming-soon/closed-projects", businessTypes: ["general-contractor"] },
  { key: "dashboards", label: "Dashboards", section: "Insights", description: "Assemble role-specific views of performance and work in motion.", route: "/coming-soon/dashboards", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "reports", label: "Reports", section: "Insights", description: "Generate operational and financial reports for the business.", route: "/coming-soon/reports", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "analytics", label: "Analytics", section: "Insights", description: "Explore trends across projects, customers, operations, and finance.", route: "/coming-soon/analytics", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "construct-intelligence", label: "Construct Intelligence", section: "Insights", description: "Surface patterns and recommendations from the full lifecycle record.", route: "/coming-soon/construct-intelligence", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
  { key: "roles", label: "Roles", section: "Administration", description: "Define what each workspace role can view and change.", route: "/settings/administration/roles", businessTypes: ["general-contractor", "subcontractor", "supplier"] },
];

export function featureIsEntitled(
  feature: FeatureCatalogEntry,
  businessTypes: TenantBusinessType[],
) {
  return feature.businessTypes.some((businessType) => businessTypes.includes(businessType));
}

export function entitledFeatures(businessTypes: TenantBusinessType[]) {
  return FEATURE_CATALOG.filter((feature) => featureIsEntitled(feature, businessTypes));
}