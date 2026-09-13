import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(workspaceRoot, "artifacts/clc-projects/src/App.tsx"), "utf8");
const shell = readFileSync(resolve(workspaceRoot, "artifacts/clc-projects/src/components/shell.tsx"), "utf8");

const requiredRoutes = [
  "/", "/sign-in/*?", "/sign-up/*?", "/pricing", "/subscribe",
  "/overview", "/dashboard/drilldown/:type", "/projects", "/projects/:id",
  "/opportunities", "/opportunities/:id", "/itb-intakes", "/bids", "/bids/:id",
  "/estimates", "/estimates/:id", "/proposals", "/proposals/:id", "/submittals",
  "/submittals/:id", "/customers", "/customers/:id", "/compliance", "/procurement",
  "/purchase-orders", "/deliveries", "/receiving", "/follow-ups", "/feedback",
  "/notifications", "/settings", "/settings/:section",
  "/settings/administration/:adminSection", "/administration/platform/customers",
  "/administration/platform/features", "/coming-soon/:item", "/accept-invitation/:token",
];

const routeLabels = [
  "Dashboard", "My Work", "Notifications", "Feature Feedback", "All Projects",
  "Opportunities", "ITB intakes", "Bids", "Estimates", "Proposals", "Submittals",
  "Customers", "Trade Partner Compliance", "Supplier operations", "Purchase orders",
  "Deliveries", "Receiving", "Settings", "Administration", "Platform Customers",
  "Feature Visibility",
];

const failures = [];
for (const route of requiredRoutes) {
  if (!app.includes(`path="${route}"`)) failures.push(`Missing route: ${route}`);
}
for (const label of routeLabels) {
  if (!shell.includes(`'${label}'`) && !shell.includes(`"${label}"`)) failures.push(`Missing shell label: ${label}`);
}
for (const legacy of [
  "/settings/access", "/administration/organization/branding",
  "/administration/organization/integrations", "/administration/organization/access",
]) {
  if (!app.includes(`path="${legacy}"`)) failures.push(`Missing legacy route: ${legacy}`);
}
if (!app.includes("function RouteLoading") || !app.includes("function UnauthorizedRoute")) {
  failures.push("Protected routes do not expose loading and unauthorized states");
}
if (!shell.includes("return ROUTE_LABELS[pathname] ?? 'Workspace'")) {
  failures.push("Shell does not provide a breadcrumb fallback");
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Validated ${requiredRoutes.length} routes, ${routeLabels.length} shell labels, legacy redirects, and protected-route states.`);