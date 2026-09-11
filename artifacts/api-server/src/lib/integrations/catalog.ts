export type IntegrationCategory =
  | "erp_financial"
  | "accounting"
  | "takeoff_estimating"
  | "ecommerce"
  | "product_information";

export type IntegrationStatus = "not_connected" | "connected" | "warning" | "failed" | "disabled";

export type ConnectorDefinition = {
  providerKey: string;
  name: string;
  category: IntegrationCategory;
  categoryLabel: string;
  description: string;
  capabilities: string[];
  entitlementKey: string;
  connectorStatus: "cataloged";
};

export const connectorCatalog: ConnectorDefinition[] = [
  {
    providerKey: "business_central",
    name: "Microsoft Dynamics 365 Business Central",
    category: "erp_financial",
    categoryLabel: "ERP & Financial",
    description: "Keep ERP, jobs, inventory, purchasing, invoices, and payments connected when a Business Central connector is enabled.",
    capabilities: ["Customers", "Vendors", "Items", "Inventory", "Jobs / Projects", "Invoices", "Payments"],
    entitlementKey: "business_central",
    connectorStatus: "cataloged",
  },
  {
    providerKey: "quickbooks",
    name: "QuickBooks Online",
    category: "accounting",
    categoryLabel: "Accounting & Financial",
    description: "Prepare accounting and payment references for a future QuickBooks Online connection.",
    capabilities: ["Customers", "Estimates", "Invoices", "Payments"],
    entitlementKey: "quickbooks",
    connectorStatus: "cataloged",
  },
  {
    providerKey: "measuresquare",
    name: "MeasureSquare",
    category: "takeoff_estimating",
    categoryLabel: "Flooring Takeoff & Estimating",
    description: "Keep flooring takeoff quantities and estimate references connected without making MeasureSquare required for project work.",
    capabilities: ["Flooring Takeoff", "Rooms / Areas", "Material Quantities", "Estimate Data"],
    entitlementKey: "measuresquare",
    connectorStatus: "cataloged",
  },
  {
    providerKey: "stack",
    name: "STACK",
    category: "takeoff_estimating",
    categoryLabel: "Takeoff & Estimating",
    description: "Prepare project, takeoff, estimate, and quantity references for STACK.",
    capabilities: ["Projects", "Takeoffs", "Estimates", "Quantities"],
    entitlementKey: "stack",
    connectorStatus: "cataloged",
  },
  {
    providerKey: "shopify",
    name: "Shopify",
    category: "ecommerce",
    categoryLabel: "Ecommerce",
    description: "Keep product, order, fulfillment, and payment references ready for configurable ecommerce workflows.",
    capabilities: ["Products", "Customers", "Orders", "Fulfillment"],
    entitlementKey: "shopify",
    connectorStatus: "cataloged",
  },
  {
    providerKey: "pim",
    name: "PIM platforms",
    category: "product_information",
    categoryLabel: "Product Information",
    description: "Prepare product master references from systems such as Perfion, Akeneo, and Plytix.",
    capabilities: ["Products", "Specifications", "Images", "Cut Sheets", "Warranty Documents"],
    entitlementKey: "pim",
    connectorStatus: "cataloged",
  },
];

export function getConnectorDefinition(providerKey: string) {
  return connectorCatalog.find((connector) => connector.providerKey === providerKey);
}