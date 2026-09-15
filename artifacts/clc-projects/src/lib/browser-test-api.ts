type BrowserAuthMode = 'authenticated' | 'platform' | 'signed-out' | 'no-tenant';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mode(): BrowserAuthMode {
  const value = new URLSearchParams(window.location.search).get('browserAuth');
  return value === 'platform' || value === 'signed-out' || value === 'no-tenant'
    ? value
    : 'authenticated';
}

const tenant = {
  id: 1,
  name: 'Browser Test Workspace',
  slug: 'browser-test-workspace',
  status: 'active',
  role: 'owner',
  customerBrandingEnabled: false,
  businessTypes: ['general-contractor'],
};

const environments = [
  {
    id: 1,
    tenantId: 1,
    name: 'Development / Test / Demo',
    slug: 'dtd',
    kind: 'dtd',
    status: 'active',
  },
  {
    id: 2,
    tenantId: 1,
    name: 'Production',
    slug: 'production',
    kind: 'production',
    status: 'active',
  },
];

const platformCustomer = {
  ...tenant,
  memberCount: 1,
  pendingInvitationCount: 0,
  environments,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const platformResources = ['runtime', 'database', 'storage', 'queue', 'secrets', 'jobs', 'logs'].map(
  (resourceType, index) => ({
    id: index + 1,
    tenantId: tenant.id,
    environmentId: environments[0].id,
    resourceType,
    status: 'ready',
    providerKey: 'browser-test',
    secretReference: null,
    externalId: `browser-${resourceType}`,
    endpoint: resourceType === 'runtime' ? 'https://runtime.example.test' : null,
  }),
);

const workflow = {
  published: {
    template: { id: 1, name: 'Browser Test Workflow', status: 'published', version: 1 },
    states: [],
    statuses: [],
    transitions: [],
  },
  draft: null,
};

const businessCustomer = {
  id: 42,
  companyName: 'Browser Test Customer',
  customerType: 'Builder',
  primaryContact: 'Test Contact',
  email: 'customer@example.test',
  phone: null,
  status: 'active',
  projectCount: 0,
  projects: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const dashboardSummary = {
  activeProjects: 0,
  pipelineValue: 0,
  receivedToDate: 0,
  invoicedValue: 0,
  openFollowUps: 0,
  needsAttention: 0,
  stageCounts: [],
};

const projectControls = {
  committedCost: 0,
  forecastMargin: 0,
  activeProjects: 0,
  openDecisions: 0,
  pendingChanges: 0,
  scheduleRiskDays: 0,
  billingPending: 0,
  closeoutReadyProjects: 0,
};

const project = {
  id: 42,
  tenantId: tenant.id,
  projectNumber: 'P-0042',
  projectName: 'Browser Test Project',
  customerName: businessCustomer.companyName,
  businessCustomerId: businessCustomer.id,
  category: 'Commercial',
  owner: 'Browser Test User',
  assignedUser: null,
  stage: 'opportunity',
  contractValue: 1250000,
  address: '42 Test Avenue',
  bidOutcome: 'pending',
  proposalStatus: 'draft',
  proposalDetails: 'Responsive browser fixture',
  requirementsSummary: 'Representative project detail content',
  contractStatus: 'draft',
  contractStart: null,
  contractEnd: null,
  contractDetails: null,
  deliveryPercent: 20,
  productCategories: ['Casework'],
  invoicedAmount: 100000,
  receivedAmount: 75000,
  billingStatus: 'in_progress',
  billingDetails: null,
  closeoutStatus: 'not_started',
  closeoutDetails: null,
  nextFollowUp: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const projectDetailControls = {
  contract: null,
  financials: null,
  commitments: [],
  issues: [],
  changeOrders: [],
  closeoutRequirements: [],
  events: [],
  payApplications: [],
  sovLines: [],
  metrics: {
    contractValue: project.contractValue,
    committedCost: 0,
    forecastCost: 0,
    forecastMargin: project.contractValue,
    scheduleRiskDays: 0,
    openIssues: 0,
    overdueIssues: 0,
    closeoutReadiness: 0,
    retainageHeld: 0,
    billedToDate: project.invoicedAmount,
  },
};

export function installBrowserTestApi() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(requestUrl, window.location.origin);
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);

    if (mode() === 'no-tenant' && url.pathname === '/api/tenant/context') {
      return json({ error: 'No customer access. Ask a customer owner to invite you.' }, 403);
    }

    if (url.pathname === '/api/tenant/context') {
      return json({
        activeTenant: tenant,
        memberships: [{ ...tenant, role: 'owner' }],
        activeEnvironment: environments[0],
        environments,
        environmentLabel: 'development',
        isPlatformAdmin: mode() === 'platform',
      });
    }
    if (url.pathname === '/api/tenant/branding/published') return json({ published: [] });
    if (url.pathname === '/api/workflow/config') return json(workflow);
    if (url.pathname === '/api/dashboard/summary') return json(dashboardSummary);
    if (url.pathname === '/api/dashboard/project-controls') return json(projectControls);
    if (url.pathname === '/api/customers/42') return json(businessCustomer);
    if (url.pathname === '/api/customers') return json([]);
    if (url.pathname === '/api/tenant/members') return json([]);
    if (url.pathname === '/api/tenant/invitations') return json([]);
    if (url.pathname === '/api/platform/customers') return json([platformCustomer]);
    if (url.pathname === '/api/platform/billing/plans') return json([]);
    if (url.pathname === '/api/platform/releases') return json([]);
    if (url.pathname === '/api/platform/environments/1/resources') {
      return json({
        environment: environments[0],
        executionContextReady: true,
        resources: platformResources,
      });
    }
    if (url.pathname === '/api/platform/environments/1/provisioning-events') {
      return json([
        {
          id: 1,
          tenantId: tenant.id,
          environmentId: environments[0].id,
          resourceId: 1,
          operationId: 1,
          actorUserId: 1,
          action: 'environment_verified',
          details: { isolated: true },
          occurredAt: new Date(0).toISOString(),
        },
      ]);
    }
    if (url.pathname === '/api/platform/environments/1/snapshots') return json([]);
    if (url.pathname === '/api/features') return json([]);
    if (url.pathname === '/api/follow-ups') return json([]);
    if (url.pathname === '/api/notifications') return json({ items: [], unreadCount: 0, total: 0 });
    if (url.pathname === '/api/dashboard/activity') return json([]);
    if (url.pathname === '/api/projects/42/activity') return json([]);
    if (url.pathname === '/api/projects/42/controls') return json(projectDetailControls);
    if (url.pathname === '/api/projects/42') return json(project);
    if (url.pathname === '/api/projects') return json([project]);

    if (url.pathname.endsWith('/supplier-account-history')) {
      return json({
        customerId: 42,
        customerName: businessCustomer.companyName,
        terms: null,
        summary: {
          orderCount: 0,
          invoiceCount: 0,
          invoicedAmount: 0,
          paidAmount: 0,
          outstandingAmount: 0,
          retainageHeld: 0,
          payableAmount: 0,
          blockedAmount: 0,
        },
        orders: [],
        paymentEvents: [],
      });
    }
    return json({});
  };
}
