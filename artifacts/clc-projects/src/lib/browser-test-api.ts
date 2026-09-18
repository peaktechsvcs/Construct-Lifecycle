type BrowserAuthMode = 'authenticated' | 'platform' | 'signed-out' | 'no-tenant';
type BrowserBrandingMode = 'default' | 'valid' | 'empty' | 'broken' | 'invalid-draft' | 'unreachable-draft' | 'save-error';
type BrowserRole = 'owner' | 'admin' | 'member' | 'viewer';
type BrowserProcurementFailure = 'products' | 'vendors' | 'quotes' | 'orders' | 'deliveries' | 'receiving' | null;

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
  return value === 'valid' || value === 'empty' || value === 'broken' || value === 'invalid-draft' || value === 'unreachable-draft' || value === 'save-error'
    ? value
    : 'default';
}

function failedOwnerInvitationMode(): boolean {
  return new URLSearchParams(window.location.search).get('browserCustomerOnboarding') === 'failed';
}

function browserProcurementFailure(): BrowserProcurementFailure {
  const value = new URLSearchParams(window.location.search).get('browserProcurementFailure');
  return value === 'products' || value === 'vendors' || value === 'quotes' || value === 'orders' || value === 'deliveries' || value === 'receiving'
    ? value
    : null;
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

const browserSupplierProduct = {
  id: 8101,
  sku: 'MAT-010',
  name: 'Browser Test Concrete',
  description: 'Procurement browser fixture material',
  category: 'Concrete',
  unit: 'each',
  defaultVendorId: 8102,
  leadTimeDays: 14,
  unitCost: 100,
  listPrice: 150,
  availableQuantity: 20,
  backorderedQuantity: 0,
  status: 'active',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const browserSecondarySupplierProduct = {
  id: 8111,
  sku: 'MAT-011',
  name: 'Browser Test Fasteners',
  description: 'Second procurement browser fixture material',
  category: 'Hardware',
  unit: 'box',
  defaultVendorId: 8112,
  leadTimeDays: 7,
  unitCost: 50,
  listPrice: 80,
  availableQuantity: 40,
  backorderedQuantity: 0,
  status: 'active',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const browserSupplierVendor = {
  id: 8102,
  name: 'Browser Test Supplier',
  contactName: 'Supplier Contact',
  email: 'supplier@example.test',
  phone: null,
  leadTimeDays: 14,
  status: 'active',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const browserSecondarySupplierVendor = {
  id: 8112,
  name: 'Browser Alternate Supplier',
  contactName: 'Alternate Supplier Contact',
  email: 'alternate-supplier@example.test',
  phone: null,
  leadTimeDays: 7,
  status: 'active',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const browserSupplierQuoteLine = {
  id: 8103,
  quoteId: 8101,
  productId: browserSupplierProduct.id,
  vendorId: browserSupplierVendor.id,
  description: browserSupplierProduct.name,
  quantity: 10,
  unit: 'each',
  unitCost: 100,
  unitPrice: 150,
  approvedSubstitution: null,
  promisedDate: '2026-10-15',
  scopeReference: null,
};

const browserSupplierQuote = {
  id: 8101,
  quoteNumber: 'SQ-8101',
  businessCustomerId: businessCustomer.id,
  customerName: businessCustomer.companyName,
  projectId: project.id,
  bidId: null,
  estimateId: null,
  proposalId: null,
  status: 'accepted',
  quoteDate: '2026-09-15',
  validUntil: '2026-10-01',
  notes: 'Browser procurement quote',
  subtotal: 1500,
  totalCost: 1000,
  totalSell: 1500,
  grossMargin: 500,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

let browserSupplierQuotes: Array<Record<string, unknown>> = [browserSupplierQuote];
let browserCreatedSupplierQuoteDetail: Record<string, unknown> | null = null;

const browserSupplierOrderLine = {
  id: 8203,
  orderId: 8202,
  sourceQuoteLineId: browserSupplierQuoteLine.id,
  productId: browserSupplierProduct.id,
  vendorId: browserSupplierVendor.id,
  description: browserSupplierProduct.name,
  quantity: 10,
  unit: 'each',
  unitCost: 100,
  unitPrice: 150,
  purchasedQuantity: 10,
  deliveredQuantity: 10,
  receivedQuantity: 0,
  backorderedQuantity: 0,
  approvedSubstitution: null,
  promisedDate: '2026-10-15',
  scopeReference: null,
};

const browserSupplierDeliveryLine = {
  id: 8205,
  deliveryId: 8204,
  orderLineId: browserSupplierOrderLine.id,
  quantityDelivered: 10,
  quantityReceived: 0,
  quantityDamaged: 0,
  quantityShort: 0,
  quantityReturned: 0,
  exceptionNote: null,
  acceptedByUserId: null,
  createdAt: new Date(0).toISOString(),
};

const browserSupplierDelivery = {
  id: 8204,
  orderId: 8202,
  deliveryNumber: 'DEL-8202',
  status: 'delivered',
  appointmentDate: '2026-09-20',
  windowStart: null,
  windowEnd: null,
  carrier: 'Browser Test Freight',
  trackingReference: 'TRACK-8202',
  jobsiteInstructions: 'Check in with the project team.',
  proofObjectPath: null,
  proofFileName: null,
  proofContentType: null,
  proofFileSize: null,
  recipientName: null,
  deliveredAt: '2026-09-20T15:00:00.000Z',
  notes: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  lines: [browserSupplierDeliveryLine],
};

const browserSupplierOrder = {
  id: 8202,
  orderNumber: 'PO-8202',
  businessCustomerId: businessCustomer.id,
  customerName: businessCustomer.companyName,
  projectId: project.id,
  bidId: null,
  estimateId: null,
  proposalId: null,
  sourceQuoteId: browserSupplierQuote.id,
  orderStatus: 'partially_fulfilled',
  paymentStatus: 'unbilled',
  orderDate: '2026-09-16',
  promisedDate: '2026-10-15',
  subtotal: 1500,
  totalCost: 1000,
  totalSell: 1500,
  grossMargin: 500,
  jobsiteInstructions: 'Check in with the project team.',
  customerVisibleStatus: 'partially_fulfilled',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const browserSupplierOrderDetail = {
  ...browserSupplierOrder,
  lines: [browserSupplierOrderLine],
  deliveries: [browserSupplierDelivery],
  invoices: [],
};

const browserSupplierOrderEvents = [{
  id: 8206,
  orderId: browserSupplierOrder.id,
  entityType: 'order',
  entityId: browserSupplierOrder.id,
  action: 'order_created',
  fromStatus: null,
  toStatus: 'approved',
  details: 'Converted from accepted quote.',
  visibleToCustomer: false,
  actorUserId: 1,
  createdAt: new Date(0).toISOString(),
}];

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

const browserChangeOrder = {
  id: 4204,
  projectId: project.id,
  changeNumber: 'CO-0042',
  changeType: 'change_request',
  title: 'Additional storefront concrete',
  description: 'Representative pending change for approval coverage.',
  status: 'under_review',
  approvalStatus: 'pending',
  proposedValue: 18500,
  approvedValue: 0,
  scheduleImpactDays: 3,
  requestedBy: 'Browser Test User',
  dueDate: '2026-09-25',
  approvedAt: null as string | null,
  documentUrl: 'https://example.test/change-orders/CO-0042',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

type BrowserControlEvent = {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  actorUserId: number | null;
  actorDisplayName: string;
  fromStatus: string | null;
  toStatus: string | null;
  comments: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

const browserChangeOrderCreatedEvent: BrowserControlEvent = {
  id: 42040,
  entityType: 'change_order',
  entityId: browserChangeOrder.id,
  action: 'change_order_created',
  actorUserId: 1001,
  actorDisplayName: 'Browser Test User',
  fromStatus: null,
  toStatus: 'pending',
  comments: null,
  details: {
    approvalStatus: { from: null, to: 'pending' },
    workflowStatus: { from: null, to: 'under_review' },
  },
  createdAt: '2026-09-15T15:02:00.000Z',
};

const projectDetailControls = {
  projectId: project.id,
  contract: null,
  scheduleItems: [],
  financials: null,
  commitments: [],
  issues: [],
  changeOrders: [browserChangeOrder],
  closeoutRequirements: [],
  events: [browserChangeOrderCreatedEvent] as BrowserControlEvent[],
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

const browserProjectControlsStorageKey = 'clc-browser-project-controls';
const browserProjectControlsResetKey = 'clc-browser-project-controls-reset';
const browserStandaloneProjectControlsStorageKey = 'clc-browser-standalone-project-controls';
const browserStandaloneProjectControlsResetKey = 'clc-browser-standalone-project-controls-reset';

function cloneStandaloneProjectControls() {
  return JSON.parse(JSON.stringify(standaloneProjectControls)) as typeof standaloneProjectControls;
}

function loadBrowserProjectControls() {
  try {
    const stored = window.localStorage.getItem(browserProjectControlsStorageKey);
    return stored ? JSON.parse(stored) as typeof standaloneProjectControls : cloneStandaloneProjectControls();
  } catch {
    return cloneStandaloneProjectControls();
  }
}

function loadStandaloneProjectControls() {
  try {
    const stored = window.sessionStorage.getItem(browserStandaloneProjectControlsStorageKey);
    return stored ? JSON.parse(stored) as typeof standaloneProjectControls : cloneStandaloneProjectControls();
  } catch {
    return cloneStandaloneProjectControls();
  }
}

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
  let browserProcurementFailureUsed = false;
  let brandingSaveAttempts = 0;
  let browserMailboxMonitors = [
    {
      provider: 'google-mail',
      providerKey: 'google_workspace',
      connected: true,
      enabled: false,
      mailbox: 'me',
      query: 'newer_than:30d (bid OR tender OR invitation)',
      intervalSeconds: 300,
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      lastError: null,
    },
    {
      provider: 'outlook',
      providerKey: 'microsoft_365',
      connected: false,
      enabled: false,
      mailbox: 'me',
      query: 'newer_than:30d bid tender invitation',
      intervalSeconds: 300,
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      lastError: null,
    },
  ];
  const browserSearchDelay = new URLSearchParams(window.location.search).get('browserSearchDelay') === '1'
    ? 600
    : 0;
  const browserSearchParams = new URLSearchParams(window.location.search);
  const browserControlsMode = browserSearchParams.get('browserControls');
  const browserControlsSaveFailure = browserSearchParams.get('browserControlsSaveFailure') === '1';
  const browserControlsValidationFailure = browserSearchParams.get('browserControlsValidationFailure') === '1';
  const browserMilestoneSaveFailure = browserSearchParams.get('browserMilestoneSaveFailure');
  const browserChangeOrderSaveFailure = browserSearchParams.get('browserChangeOrderSaveFailure') === '1';
  if ((browserControlsMode === 'reload' || browserControlsMode === 'standalone') && browserSearchParams.get('browserControlsReset') === '1') {
    try {
      const resetKey = browserControlsMode === 'reload'
        ? browserProjectControlsResetKey
        : browserStandaloneProjectControlsResetKey;
      if (!window.sessionStorage.getItem(resetKey)) {
        if (browserControlsMode === 'reload') {
          window.localStorage.removeItem(browserProjectControlsStorageKey);
        } else {
          window.sessionStorage.removeItem(browserStandaloneProjectControlsStorageKey);
        }
        window.sessionStorage.setItem(resetKey, '1');
      }
    } catch {
      // Browser test storage may be unavailable in a restricted context.
    }
  }
  const browserControls = browserControlsMode === 'reload'
    ? loadBrowserProjectControls()
    : browserControlsMode === 'standalone'
      ? loadStandaloneProjectControls()
      : standaloneProjectControls;
  if (!Array.isArray(browserControls.events)) browserControls.events = [];
  let browserContractSaveAttempts = 0;
  let browserContractValidationAttempts = 0;
  let browserMilestoneSaveAttempts = 0;
  let browserChangeOrderSaveAttempts = 0;
  let browserCreatedChangeOrderId = 4205;
  let browserCreatedControlEventId = 42041;
  const persistBrowserProjectControls = () => {
    if (browserControlsMode === 'reload') {
      window.localStorage.setItem(browserProjectControlsStorageKey, JSON.stringify(browserControls));
    } else if (browserControlsMode === 'standalone') {
      window.sessionStorage.setItem(browserStandaloneProjectControlsStorageKey, JSON.stringify(browserControls));
    }
  };
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
      if (String(init?.method ?? 'GET').toUpperCase() === 'PUT') {
        if (brandingMode() === 'save-error' && brandingSaveAttempts++ === 0) {
          return json({ error: 'Browser test save failure' }, 503);
        }
        let draft = {};
        if (typeof init?.body === 'string') {
          try {
            draft = JSON.parse(init.body);
          } catch {
            // The real API client always sends JSON; keep the fixture response valid if that changes.
          }
        }
        return json({ draft, published: [] });
      }
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
      if (browserControlsSaveFailure && browserContractSaveAttempts++ === 0) {
        return json({ error: 'Browser test contract save failure' }, 503);
      }
      if (browserControlsValidationFailure && browserContractValidationAttempts++ === 0) {
        return json({
          error: 'Contract details need attention',
          code: 'VALIDATION_ERROR',
          details: [
            { path: ['documentUrl'], code: 'invalid_format', message: 'Use a valid HTTP or HTTPS URL.' },
            { path: ['participants', 0, 'contactEmail'], code: 'invalid_format', message: 'Enter a valid email address.' },
          ],
        }, 400);
      }
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      const updatedContract = {
        ...(browserControls.contract ?? browserContract),
        ...requestBody,
        participants: Array.isArray(requestBody.participants)
          ? requestBody.participants.map((participant, index) => ({ ...participant, id: 4300 + index }))
          : [],
        updatedAt: new Date(0).toISOString(),
      } as typeof browserContract;
      browserControls.contract = updatedContract;
      persistBrowserProjectControls();
      return json(updatedContract);
    }
    if (url.pathname === `/api/projects/${project.id}/controls/change-orders` && requestMethod === 'POST') {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form validates the request before submitting.
      }
      const createdApprovalStatus = typeof requestBody.approvalStatus === 'string' ? requestBody.approvalStatus : 'pending';
      const createdStatus = typeof requestBody.status === 'string' ? requestBody.status : 'draft';
      const createdChangeOrder = {
        ...browserChangeOrder,
        ...requestBody,
        id: browserCreatedChangeOrderId++,
        projectId: project.id,
        approvedValue: Number(requestBody.approvedValue ?? 0),
        approvalStatus: createdApprovalStatus,
        status: createdStatus,
        approvedAt: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      browserControls.changeOrders = [...browserControls.changeOrders, createdChangeOrder];
      browserControls.events = [
        ...browserControls.events,
        {
          id: browserCreatedControlEventId++,
          entityType: 'change_order',
          entityId: createdChangeOrder.id,
          action: 'change_order_created',
          actorUserId: 1001,
          actorDisplayName: 'Browser Test User',
          fromStatus: null,
          toStatus: createdChangeOrder.approvalStatus,
          comments: null,
          details: {
            approvalStatus: { from: null, to: createdChangeOrder.approvalStatus },
            workflowStatus: { from: null, to: createdChangeOrder.status },
          },
          createdAt: new Date(0).toISOString(),
        },
      ];
      persistBrowserProjectControls();
      return json(createdChangeOrder, 201);
    }
    if (url.pathname.startsWith(`/api/projects/${project.id}/controls/change-orders/`) && requestMethod === 'PATCH') {
      const changeOrderId = Number(url.pathname.split('/').pop());
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form validates the request before submitting.
      }
      if (requestBody.approvalStatus && !['owner', 'admin'].includes(browserRole()) && mode() !== 'platform') {
        return json({ error: 'Only customer administrators can approve a change order.' }, 403);
      }
      if (browserChangeOrderSaveFailure && browserChangeOrderSaveAttempts++ === 0) {
        return json({ error: 'Browser test change-order save failure' }, 503);
      }
      const existing = browserControls.changeOrders.find((item) => item.id === changeOrderId);
      if (!existing) return json({ error: 'Change order not found' }, 404);
      const requestedApprovalStatus = typeof requestBody.approvalStatus === 'string' ? requestBody.approvalStatus : undefined;
      const requestedApprovedValue = typeof requestBody.approvedValue === 'number' ? requestBody.approvedValue : undefined;
      const previousApprovalStatus = existing.approvalStatus;
      const previousWorkflowStatus = existing.status;
      const updatedChangeOrder = {
        ...existing,
        ...requestBody,
        id: existing.id,
        projectId: project.id,
        approvedValue: requestedApprovedValue ?? (requestedApprovalStatus === 'approved' ? existing.proposedValue : existing.approvedValue),
        approvedAt: requestedApprovalStatus === 'approved' ? new Date(0).toISOString() : existing.approvedAt,
        updatedAt: new Date(0).toISOString(),
      };
      browserControls.changeOrders = browserControls.changeOrders.map((item) => item.id === changeOrderId ? updatedChangeOrder : item);
      browserControls.events = [
        ...browserControls.events,
        {
          id: browserCreatedControlEventId++,
          entityType: 'change_order',
          entityId: existing.id,
          action: 'change_order_updated',
          actorUserId: 1001,
          actorDisplayName: 'Browser Test User',
          fromStatus: previousApprovalStatus,
          toStatus: updatedChangeOrder.approvalStatus,
          comments: null,
          details: {
            approvalStatus: { from: previousApprovalStatus, to: updatedChangeOrder.approvalStatus },
            workflowStatus: { from: previousWorkflowStatus, to: updatedChangeOrder.status },
          },
          createdAt: new Date(0).toISOString(),
        },
      ];
      persistBrowserProjectControls();
      return json(updatedChangeOrder);
    }
    if (url.pathname === `/api/projects/${project.id}/controls/schedule` && requestMethod === 'POST') {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      const createdMilestone = {
        ...browserMilestone,
        ...requestBody,
        id: 4203,
        projectId: project.id,
        itemType: 'milestone',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      browserControls.scheduleItems = [...browserControls.scheduleItems, createdMilestone];
      persistBrowserProjectControls();
      return json(createdMilestone, 201);
    }
    if (url.pathname === `/api/projects/${project.id}/controls/schedule/${browserMilestone.id}` && requestMethod === 'PATCH') {
      if (browserMilestoneSaveFailure && browserMilestoneSaveAttempts++ === 0) {
        if (browserMilestoneSaveFailure === 'validation') {
          return json({ error: 'Invalid schedule update' }, 400);
        }
        if (browserMilestoneSaveFailure === 'permission') {
          return json({ error: 'Insufficient workspace permissions for this operation' }, 403);
        }
        if (browserMilestoneSaveFailure === 'conflict') {
          const serverMilestone = browserControls.scheduleItems.find((item) => item.id === browserMilestone.id);
          if (serverMilestone) {
            serverMilestone.name = 'Server updated milestone';
            serverMilestone.updatedAt = new Date(1).toISOString();
          }
          return json({ error: 'This schedule item changed since you opened it', code: 'SCHEDULE_ITEM_CONFLICT' }, 409);
        }
        return json({ error: 'Browser test milestone save failure' }, 503);
      }
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      const updatedMilestone = {
        ...browserMilestone,
        ...requestBody,
        id: browserMilestone.id,
        projectId: project.id,
        itemType: 'milestone',
        updatedAt: new Date(0).toISOString(),
      };
      browserControls.scheduleItems = browserControls.scheduleItems.map((item) =>
        item.id === browserMilestone.id ? updatedMilestone : item,
      );
      persistBrowserProjectControls();
      return json(updatedMilestone);
    }
    if (url.pathname === '/api/itb-intakes') return json([browserMailboxIntake]);
    if (url.pathname === `/api/itb-intakes/${browserMailboxIntake.id}/documents`) return json([]);
    if (url.pathname === `/api/itb-intakes/${browserMailboxIntake.id}`) return json(browserMailboxIntake);
    if (url.pathname === '/api/itb-intakes/mailbox/monitor' && requestMethod === 'GET') return json(browserMailboxMonitors);
    if (url.pathname.startsWith('/api/itb-intakes/mailbox/monitor/') && requestMethod === 'PUT') {
      const provider = url.pathname.endsWith('/outlook') ? 'outlook' : 'google-mail';
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      browserMailboxMonitors = browserMailboxMonitors.map((monitor) => monitor.provider === provider
        ? { ...monitor, ...requestBody }
        : monitor);
      return json(browserMailboxMonitors.find((monitor) => monitor.provider === provider));
    }
    if (url.pathname === '/api/itb-intakes/mailbox/preview') {
      const scenario = browserMailboxScenario();
      const provider = url.searchParams.get('provider') === 'outlook' ? 'outlook' : 'google-mail';
      return json([{
        ...browserMailboxMessage,
        provider,
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
    if (url.pathname === '/api/supplier-products') {
      if (browserProcurementFailure() === 'products' && !browserProcurementFailureUsed) {
        browserProcurementFailureUsed = true;
        return json({ error: 'Supplier product catalog is temporarily unavailable' }, 503);
      }
      return json([browserSupplierProduct, browserSecondarySupplierProduct]);
    }
    if (url.pathname === '/api/supplier-vendors') {
      if (browserProcurementFailure() === 'vendors' && !browserProcurementFailureUsed) {
        browserProcurementFailureUsed = true;
        return json({ error: 'Supplier vendor directory is temporarily unavailable' }, 503);
      }
      return json([browserSupplierVendor, browserSecondarySupplierVendor]);
    }
    if (url.pathname === '/api/supplier-customer-terms') return json([]);
    if (url.pathname === '/api/supplier-quotes' && requestMethod === 'GET') {
      if (browserProcurementFailure() === 'quotes' && !browserProcurementFailureUsed) {
        browserProcurementFailureUsed = true;
        return json({ error: 'Supplier quote queue is temporarily unavailable' }, 503);
      }
      return json(browserSupplierQuotes);
    }
    if (url.pathname === '/api/supplier-quotes' && requestMethod === 'POST') {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      const requestLines = Array.isArray(requestBody.lines) ? requestBody.lines as Array<Record<string, unknown>> : [];
      const requestLine = requestLines[0] ?? {};
      const quantity = Number(requestLine.quantity ?? 0);
      const unitCost = Number(requestLine.unitCost ?? 0);
      const unitPrice = Number(requestLine.unitPrice ?? 0);
      const secondaryQuantity = 3;
      const secondaryUnitCost = 50;
      const secondaryUnitPrice = 80;
      const createdQuote = {
        id: 8301,
        quoteNumber: 'SQ-8301',
        businessCustomerId: Number(requestBody.businessCustomerId ?? businessCustomer.id),
        customerName: businessCustomer.companyName,
        projectId: null,
        bidId: null,
        estimateId: null,
        proposalId: null,
        status: 'draft',
        quoteDate: '2026-09-17',
        validUntil: null,
        notes: null,
        subtotal: quantity * unitPrice + secondaryQuantity * secondaryUnitPrice,
        totalCost: quantity * unitCost + secondaryQuantity * secondaryUnitCost,
        totalSell: quantity * unitPrice + secondaryQuantity * secondaryUnitPrice,
        grossMargin: quantity * (unitPrice - unitCost) + secondaryQuantity * (secondaryUnitPrice - secondaryUnitCost),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      const createdDetail = {
        ...createdQuote,
        lines: [{
          id: 8302,
          quoteId: createdQuote.id,
          productId: browserSupplierProduct.id,
          vendorId: browserSupplierVendor.id,
          description: String(requestLine.description ?? browserSupplierProduct.name),
          quantity,
          unit: String(requestLine.unit ?? browserSupplierProduct.unit),
          unitCost,
          unitPrice,
          approvedSubstitution: null,
          promisedDate: requestLine.promisedDate ? String(requestLine.promisedDate) : null,
          scopeReference: null,
         }, {
           id: 8303,
           quoteId: createdQuote.id,
           productId: browserSecondarySupplierProduct.id,
           vendorId: browserSecondarySupplierVendor.id,
           description: browserSecondarySupplierProduct.name,
           quantity: secondaryQuantity,
           unit: browserSecondarySupplierProduct.unit,
           unitCost: secondaryUnitCost,
           unitPrice: secondaryUnitPrice,
           approvedSubstitution: null,
           promisedDate: null,
           scopeReference: null,
        }],
      };
      browserCreatedSupplierQuoteDetail = createdDetail;
      browserSupplierQuotes = [...browserSupplierQuotes, createdQuote];
      return json(createdDetail, 201);
    }
    if (url.pathname === `/api/supplier-quotes/${browserSupplierQuote.id}` && requestMethod === 'GET') {
      return json({ ...browserSupplierQuote, lines: [browserSupplierQuoteLine] });
    }
    if (url.pathname === `/api/supplier-quotes/${browserCreatedSupplierQuoteDetail?.id}` && browserCreatedSupplierQuoteDetail && requestMethod === 'PATCH') {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        // The production form already validates the request before submitting.
      }
      const requestLines = Array.isArray(requestBody.lines) ? requestBody.lines as Array<Record<string, unknown>> : [];
      const lines = requestLines.map((line, index) => ({
        ...line,
        id: 8302 + index,
        quoteId: 8301,
        productId: line.productId == null ? (index === 0 ? browserSupplierProduct.id : browserSecondarySupplierProduct.id) : Number(line.productId),
        vendorId: line.vendorId == null ? (index === 0 ? browserSupplierVendor.id : browserSecondarySupplierVendor.id) : Number(line.vendorId),
        quantity: Number(line.quantity ?? 0),
        unit: String(line.unit ?? (index === 0 ? browserSupplierProduct.unit : browserSecondarySupplierProduct.unit)),
        unitCost: Number(line.unitCost ?? 0),
        unitPrice: Number(line.unitPrice ?? 0),
        promisedDate: line.promisedDate ? String(line.promisedDate) : null,
      }));
      const updatedQuote = {
        ...browserCreatedSupplierQuoteDetail,
        subtotal: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
        totalCost: lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
        totalSell: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
        grossMargin: lines.reduce((sum, line) => sum + line.quantity * (line.unitPrice - line.unitCost), 0),
        updatedAt: new Date(0).toISOString(),
        lines,
      };
      browserCreatedSupplierQuoteDetail = updatedQuote;
      browserSupplierQuotes = browserSupplierQuotes.map((quote) => quote.id === 8301
        ? { ...quote, ...updatedQuote, lines: undefined }
        : quote);
      return json(updatedQuote);
    }
    if (url.pathname === `/api/supplier-quotes/${browserCreatedSupplierQuoteDetail?.id}` && browserCreatedSupplierQuoteDetail) {
      return json(browserCreatedSupplierQuoteDetail);
    }
    if (url.pathname === `/api/supplier-quotes/${browserSupplierQuote.id}/convert` && requestMethod === 'POST') {
      browserSupplierQuote.status = 'converted';
      return json(browserSupplierOrderDetail);
    }
    if (url.pathname === '/api/supplier-orders' && requestMethod === 'GET') {
      if (['orders', 'deliveries', 'receiving'].includes(browserProcurementFailure() ?? '') && !browserProcurementFailureUsed) {
        browserProcurementFailureUsed = true;
        return json({ error: 'Supplier order queue is temporarily unavailable' }, 503);
      }
      return json([browserSupplierOrder]);
    }
    if (url.pathname === `/api/supplier-orders/${browserSupplierOrder.id}`) return json(browserSupplierOrderDetail);
    if (url.pathname === `/api/supplier-orders/${browserSupplierOrder.id}/events`) return json(browserSupplierOrderEvents);
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
      const controls = browserControlsMode === 'standalone' || browserControlsMode === 'reload'
        ? browserControls
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
