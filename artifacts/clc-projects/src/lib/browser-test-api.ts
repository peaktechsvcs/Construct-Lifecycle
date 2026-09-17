type BrowserAuthMode = 'authenticated' | 'platform' | 'signed-out' | 'no-tenant';
type BrowserBrandingMode = 'default' | 'valid' | 'empty' | 'broken' | 'invalid-draft' | 'unreachable-draft';
type BrowserRole = 'owner' | 'admin' | 'member' | 'viewer';

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

function brandingMode(): BrowserBrandingMode {
  const value = new URLSearchParams(window.location.search).get('browserBranding');
  return value === 'valid' || value === 'empty' || value === 'broken' || value === 'invalid-draft' || value === 'unreachable-draft'
    ? value
    : 'default';
}

function failedOwnerInvitationMode(): boolean {
  return new URLSearchParams(window.location.search).get('browserCustomerOnboarding') === 'failed';
}

type BrowserMailboxScenario = 'existing' | 'duplicate' | 'provider-failure' | null;

function browserMailboxScenario(): BrowserMailboxScenario {
  const value = new URLSearchParams(window.location.search).get('browserMailbox');
  return value === 'existing' || value === 'duplicate' || value === 'provider-failure' ? value : null;
}

function browserRole(): BrowserRole {
  const value = new URLSearchParams(window.location.search).get('browserRole');
  if (value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer') {
    window.sessionStorage.setItem('clc-browser-role', value);
    return value;
  }
  const stored = window.sessionStorage.getItem('clc-browser-role');
  return stored === 'owner' || stored === 'admin' || stored === 'member' || stored === 'viewer'
    ? stored
    : 'owner';
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

const failedOnboardingCustomer = {
  ...platformCustomer,
  id: 2,
  name: 'Failed Invitation Browser Customer',
  slug: 'failed-invitation-browser-customer',
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
    template: {
      id: 1,
      name: 'Browser Test Workflow',
      status: 'published',
      version: 1,
      activeProjectStatusKeys: ['waiting', 'active', 'field_active'],
    },
    states: [],
    statuses: [
      {
        id: 1,
        workflowTemplateId: 1,
        stableKey: 'active',
        displayName: 'In Flight',
        stateKeys: [],
        displayOrder: 1,
        active: true,
        required: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: 2,
        workflowTemplateId: 1,
        stableKey: 'waiting',
        displayName: 'Paused',
        stateKeys: [],
        displayOrder: 0,
        active: true,
        required: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: 3,
        workflowTemplateId: 1,
        stableKey: 'field_active',
        displayName: 'Field Work',
        stateKeys: [],
        displayOrder: 2,
        active: true,
        required: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
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

const alternateBusinessCustomer = {
  ...businessCustomer,
  id: 43,
  companyName: 'Browser Alternate Customer',
};

const browserTradePartner = {
  id: 7,
  companyName: 'Browser Test Trade Partner',
  tradeCapabilities: ['Electrical'],
  serviceAreas: ['Denver'],
  primaryContact: 'Test Contact',
  email: 'trade-partner@example.test',
  phone: null,
  qualificationStatus: 'approved',
  qualificationReviewedAt: new Date(0).toISOString(),
  status: 'active',
  complianceCounts: { total: 4, approved: 1, pending: 3, expired: 0 },
  gates: { award: true, mobilization: true, billing: true, closeout: true, blockers: [] },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const browserComplianceDocuments = [
  {
    id: 701,
    tradePartnerId: browserTradePartner.id,
    projectId: 42,
    documentType: 'insurance_certificate',
    title: 'General liability certificate',
    documentNumber: null,
    issuer: 'Browser Test Insurance',
    expiresOn: null,
    status: 'submitted',
    objectPath: '/objects/browser-clean-document',
    originalName: 'liability.pdf',
    contentType: 'application/pdf',
    fileSize: 1024,
    scanStatus: 'clean',
    scanMessage: 'Security scan passed.',
    reviewedAt: null,
    reviewNotes: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 702,
    tradePartnerId: browserTradePartner.id,
    projectId: 42,
    documentType: 'bond',
    title: 'Replacement awaiting scan',
    documentNumber: null,
    issuer: null,
    expiresOn: null,
    status: 'requested',
    objectPath: '/objects/browser-pending-document',
    originalName: 'bond.pdf',
    contentType: 'application/pdf',
    fileSize: 2048,
    scanStatus: 'unavailable',
    scanMessage: 'Security scan unavailable. Try again later.',
    reviewedAt: null,
    reviewNotes: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 703,
    tradePartnerId: browserTradePartner.id,
    projectId: 42,
    documentType: 'license',
    title: 'License blocked by scan',
    documentNumber: null,
    issuer: null,
    expiresOn: null,
    status: 'requested',
    objectPath: '/objects/browser-infected-document',
    originalName: 'license.pdf',
    contentType: 'application/pdf',
    fileSize: 2048,
    scanStatus: 'infected',
    scanMessage: 'File blocked after a security scan.',
    reviewedAt: null,
    reviewNotes: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 704,
    tradePartnerId: browserTradePartner.id,
    projectId: 42,
    documentType: 'safety_information',
    title: 'Safety file scan timed out',
    documentNumber: null,
    issuer: null,
    expiresOn: null,
    status: 'requested',
    objectPath: '/objects/browser-timeout-document',
    originalName: 'safety.pdf',
    contentType: 'application/pdf',
    fileSize: 2048,
    scanStatus: 'timeout',
    scanMessage: 'Security scan timed out. Try again later.',
    reviewedAt: null,
    reviewNotes: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

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

const browserContract = {
  id: 4201,
  projectId: project.id,
  contractNumber: 'CNT-0042',
  deliveryMethod: 'design_bid_build',
  originalValue: 1250000,
  currentValue: 1300000,
  contractStart: '2026-01-15',
  contractEnd: '2026-12-15',
  noticeToProceed: '2026-01-20',
  paymentTerms: 'Net 30',
  retainagePercent: 10,
  retainageCap: null,
  approvalStatus: 'approved',
  status: 'active',
  documentUrl: 'https://example.test/contracts/CNT-0042',
  participants: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const browserMilestone = {
  id: 4202,
  projectId: project.id,
  itemNumber: 'MS-001',
  name: 'Site mobilization',
  itemType: 'milestone',
  predecessor: null,
  plannedStart: '2026-02-01',
  plannedEnd: '2026-02-15',
  actualStart: null,
  actualEnd: null,
  status: 'planned',
  ownerName: 'Browser Test User',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const projectDetailControls = {
  projectId: project.id,
  contract: null,
  scheduleItems: [],
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

const standaloneProjectControls = {
  ...projectDetailControls,
  contract: browserContract,
  scheduleItems: [browserMilestone],
};

const browserMailboxIntake = {
  id: 7201,
  tenantId: tenant.id,
  environmentId: environments[0].id,
  sourceType: 'gmail',
  sourceProvider: 'google-mail',
  sourceMessageId: 'browser-mailbox-message',
  sourceThreadId: 'browser-mailbox-thread',
  sourceMailbox: 'me',
  sourceSender: 'estimating@example.test',
  sourceSenderEmail: 'estimating@example.test',
  sourceSubject: 'ITB Browser Mailbox Recovery',
  sourceReceivedAt: '2026-09-15T15:00:00.000Z',
  sourceBody: 'Project: Browser Mailbox Recovery\nBid due: September 30, 2026\nContact: Browser Test Contact\nContact email: browser-contact@example.test\nLocation: 42 Test Avenue',
  status: 'review',
  extractionStatus: 'completed',
  extraction: {
    issuer: { value: 'Browser Test Builder', confidence: 0.93, evidence: 'Issuer: Browser Test Builder' },
    contactName: { value: 'Browser Test Contact', confidence: 0.9, evidence: 'Contact: Browser Test Contact' },
    contactEmail: { value: 'browser-contact@example.test', confidence: 0.98, evidence: 'browser-contact@example.test' },
    contactPhone: { value: null, confidence: 0, evidence: 'No phone number found.' },
    projectName: { value: 'Browser Mailbox Recovery', confidence: 0.94, evidence: 'Project: Browser Mailbox Recovery' },
    location: { value: '42 Test Avenue', confidence: 0.91, evidence: 'Location: 42 Test Avenue' },
    dueDate: { value: '2026-09-30', confidence: 0.97, evidence: 'Bid due: September 30, 2026' },
    scope: [],
    requirements: [],
    alternates: [],
    estimatedValue: { value: null, confidence: 0, evidence: 'No estimated value found.' },
  },
  warnings: [],
  errorMessage: null,
  businessCustomerId: null,
  opportunityId: null,
  bidId: null,
  mergedIntoId: null,
  reviewedAt: null,
  attachments: [],
  createdAt: '2026-09-15T15:01:00.000Z',
  updatedAt: '2026-09-15T15:01:00.000Z',
};

const browserMailboxMessage = {
  provider: 'google-mail',
  messageId: 'browser-mailbox-message',
  threadId: 'browser-mailbox-thread',
  subject: browserMailboxIntake.sourceSubject,
  sender: browserMailboxIntake.sourceSender,
  senderEmail: browserMailboxIntake.sourceSenderEmail,
  receivedAt: browserMailboxIntake.sourceReceivedAt,
  snippet: 'Project: Browser Mailbox Recovery. Bid due: September 30, 2026.',
  imported: false,
  intakeId: null,
};

export function installBrowserTestApi() {
  const originalFetch = window.fetch.bind(window);
  const browserSearchDelay = new URLSearchParams(window.location.search).get('browserSearchDelay') === '1'
    ? 600
    : 0;
  const browserTestWindow = window as Window & {
    __clcBrowserTestDrilldownSearches?: string[];
  };
  browserTestWindow.__clcBrowserTestDrilldownSearches = [];

  window.fetch = async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(requestUrl, window.location.origin);
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);

    if (mode() === 'no-tenant' && url.pathname === '/api/tenant/context') {
      return json({ error: 'No customer access. Ask a customer owner to invite you.' }, 403);
    }

    if (url.pathname === '/api/tenant/context') {
      const customerBrandingEnabled = brandingMode() !== 'default';
      const role = browserRole();
      return json({
        activeTenant: { ...tenant, role, customerBrandingEnabled },
        memberships: [{ ...tenant, role, customerBrandingEnabled }],
        activeEnvironment: environments[0],
        environments,
        environmentLabel: 'development',
        isPlatformAdmin: mode() === 'platform',
        effectiveAccess: {
          billingConfigured: false,
          state: 'not_subscribed',
          subscriptionStatus: null,
          cancelAtPeriodEnd: false,
          planId: null,
          planName: null,
          entitlements: {},
        },
      });
    }
    if (url.pathname === '/api/tenant/branding/published') {
      const currentBrandingMode = brandingMode();
      if (currentBrandingMode === 'valid' || currentBrandingMode === 'broken') {
        return json({
          published: [{
            id: 1,
            version: 1,
            data: {
              logoUrl: currentBrandingMode === 'valid'
                ? '/logo-full.png'
                : '/__browser-test/missing-logo.png',
            },
            publishedAt: new Date(0).toISOString(),
          }],
        });
      }
      return json({ published: [] });
    }
    if (url.pathname === '/api/tenant/branding') {
      if (brandingMode() === 'invalid-draft' || brandingMode() === 'unreachable-draft') {
        return json({
          draft: {
            logoUrl: brandingMode() === 'unreachable-draft' ? '/__browser-test/missing-logo.png' : 'javascript:alert(1)',
            primaryColor: '#ffffff',
            secondaryColor: '#12zz34',
            accentColor: '#f1f5f9',
            backgroundColor: '#ffffff',
            foregroundColor: '#ffffff',
          },
          published: [],
        });
      }
      return json({
        draft: {
          logoUrl: '',
          primaryColor: '#2563eb',
          secondaryColor: '#f1f5f9',
          accentColor: '#f1f5f9',
          backgroundColor: '#ffffff',
          foregroundColor: '#0f172a',
        },
        published: [],
      });
    }
    if (url.pathname === '/api/workflow/config') return json(workflow);
    const requestMethod = String(init?.method ?? 'GET').toUpperCase();
    if (url.pathname === `/api/projects/${project.id}/controls/contract` && requestMethod === 'PUT') {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      return json({
        ...browserContract,
        ...requestBody,
        participants: Array.isArray(requestBody.participants) ? requestBody.participants : [],
        updatedAt: new Date(0).toISOString(),
      });
    }
    if (url.pathname === `/api/projects/${project.id}/controls/schedule` && requestMethod === 'POST') {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      return json({
        ...browserMilestone,
        ...requestBody,
        id: 4203,
        projectId: project.id,
        itemType: 'milestone',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }, 201);
    }
    if (url.pathname === `/api/projects/${project.id}/controls/schedule/${browserMilestone.id}` && requestMethod === 'PATCH') {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      return json({
        ...browserMilestone,
        ...requestBody,
        id: browserMilestone.id,
        projectId: project.id,
        itemType: 'milestone',
        updatedAt: new Date(0).toISOString(),
      });
    }
    if (url.pathname === '/api/itb-intakes') return json([browserMailboxIntake]);
    if (url.pathname === `/api/itb-intakes/${browserMailboxIntake.id}/documents`) return json([]);
    if (url.pathname === `/api/itb-intakes/${browserMailboxIntake.id}`) return json(browserMailboxIntake);
    if (url.pathname === '/api/itb-intakes/mailbox/preview') {
      const scenario = browserMailboxScenario();
      return json([{
        ...browserMailboxMessage,
        imported: scenario === 'existing',
        intakeId: scenario === 'existing' ? browserMailboxIntake.id : null,
      }]);
    }
    if (url.pathname === '/api/itb-intakes/mailbox/import' && requestMethod === 'POST') {
      const scenario = browserMailboxScenario();
      if (scenario === 'duplicate') {
        return json({ error: 'This mailbox message was already imported', intakeId: browserMailboxIntake.id }, 409);
      }
      if (scenario === 'provider-failure') {
        return json({ error: 'Google Workspace mailbox is not connected or could not be read' }, 424);
      }
      return json(browserMailboxIntake, 201);
    }
    if (url.pathname === '/api/dashboard/summary') return json(dashboardSummary);
    if (url.pathname === '/api/dashboard/project-controls') return json(projectControls);
    if (url.pathname === '/api/dashboard/drilldown' && url.searchParams.get('type') === 'active-projects') {
      browserTestWindow.__clcBrowserTestDrilldownSearches?.push(url.searchParams.get('search') ?? '');
      if (browserSearchDelay > 0 && url.searchParams.get('search')?.trim()) {
        await new Promise((resolve) => setTimeout(resolve, browserSearchDelay));
      }
      if (url.searchParams.get('search')?.trim()) {
        return json({
          title: 'Active Projects',
          type: 'active-projects',
          count: 0,
          total: 0,
          projects: [],
        });
      }
      return json({
        title: 'Active Projects',
        type: 'active-projects',
        count: 1,
        total: project.contractValue,
        projects: [{
          id: project.id,
          projectNumber: project.projectNumber,
          customerName: project.customerName,
          projectName: 'Browser Test Waiting Project',
          owner: project.owner,
          ownerUserId: null,
          assignedUser: null,
          stage: 'deliver',
          projectStatus: 'waiting',
          contractValue: project.contractValue,
          receivedAmount: project.receivedAmount,
          deliveryPercent: project.deliveryPercent,
          contractStart: null,
          contractEnd: null,
          nextFollowUp: null,
          updatedAt: project.updatedAt,
          nextAction: null,
        }],
      });
    }
    if (url.pathname === '/api/customers/42') return json(businessCustomer);
    if (url.pathname === '/api/customers') return json([businessCustomer, alternateBusinessCustomer]);
    if (url.pathname === '/api/trade-partners') return json([browserTradePartner]);
    if (url.pathname === `/api/trade-partners/${browserTradePartner.id}`) {
      return json({ partner: browserTradePartner, complianceDocuments: browserComplianceDocuments, requirements: [], agreements: [] });
    }
    if (url.pathname === `/api/projects/${project.id}/compliance-requirements`) return json([]);
    if (url.pathname === '/api/subcontract-agreements') return json([]);
    if (url.pathname === '/api/subcontract-agreement-audit-events') return json([]);
    if (url.pathname === '/api/tenant/members') return json([]);
    if (url.pathname === '/api/tenant/invitations') return json([]);
    if (url.pathname === '/api/platform/customers' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
      if (!failedOwnerInvitationMode()) return json({ error: 'Unsupported browser fixture mutation' }, 400);
      let requestBody: { name?: unknown; slug?: unknown } = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as typeof requestBody;
      } catch {
        // The production form already validates the request before submitting.
      }
      const customer = {
        ...failedOnboardingCustomer,
        name: typeof requestBody.name === 'string' ? requestBody.name.trim() : failedOnboardingCustomer.name,
        slug: typeof requestBody.slug === 'string' ? requestBody.slug.trim().toLowerCase() : failedOnboardingCustomer.slug,
      };
      return json({
        customer,
        invitation: null,
        invitationToken: null,
        ownerEmail: 'owner-retry@example.test',
        invitationStatus: 'failed',
        invitationError: 'Workspace created, but the owner invitation could not be created. Retry it from customer access.',
        invitationDelivery: null,
      }, 201);
    }
    if (url.pathname === '/api/platform/customers') return json([platformCustomer]);
    if (url.pathname === `/api/platform/customers/${failedOnboardingCustomer.id}`) {
      return json({
        customer: failedOnboardingCustomer,
        members: [],
        invitations: [],
      });
    }
    if (url.pathname === `/api/platform/customers/${failedOnboardingCustomer.id}/audit-events`) return json([]);
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
    if (url.pathname === '/api/platform/environments/1/provisioning-operations') {
      return json([]);
    }
    if (url.pathname === '/api/platform/environments/1/snapshots') return json([]);
    if (url.pathname === '/api/features') return json([]);
    if (url.pathname === '/api/follow-ups') return json([]);
    if (url.pathname === '/api/notifications') return json({ items: [], unreadCount: 0, total: 0 });
    if (url.pathname === '/api/dashboard/activity') return json([]);
    if (url.pathname === '/api/projects/42/activity') return json([]);
    if (url.pathname === '/api/projects/42/controls') {
      const controls = new URLSearchParams(window.location.search).get('browserControls') === 'standalone'
        ? standaloneProjectControls
        : projectDetailControls;
      return json(controls);
    }
    if (url.pathname === '/api/projects/42') return json(project);
    if (url.pathname === '/api/projects' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
      return json({ ...project, id: 43, projectNumber: 'P-0043', projectName: 'Browser Created Project' }, 201);
    }
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
