import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, ClipboardCheck, Clock3, HandCoins, Plus, Search, ShieldCheck, XCircle, type LucideIcon } from 'lucide-react';
import {
  getGetSubcontractAgreementQueryKey,
  getGetTradePartnerQueryKey,
  getListProjectComplianceRequirementsQueryKey,
  getListProjectsQueryKey,
  getListSubcontractAgreementsQueryKey,
  getListTradePartnersQueryKey,
  useCreateProjectComplianceRequirement,
  useCreateSubcontractAgreement,
  useCreateSubcontractChangeOrder,
  useCreateSubcontractCloseoutItem,
  useCreateSubcontractPayApplication,
  useCreateSubcontractWaiver,
  useCreateTradePartner,
  useCreateTradePartnerComplianceDocument,
  useGetSubcontractAgreement,
  useGetTradePartner,
  useListProjectComplianceRequirements,
  useListProjects,
  useListSubcontractAgreements,
  useListTradePartners,
  useUpdateTradePartnerComplianceDocument,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring';

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function statusTone(status: string): 'green' | 'orange' | 'red' | 'teal' | 'neutral' {
  if (['approved', 'active', 'paid', 'unconditional', 'final'].includes(status)) return 'green';
  if (['rejected', 'expired', 'suspended', 'missing'].includes(status)) return 'red';
  if (['submitted', 'pending', 'conditional', 'open'].includes(status)) return 'orange';
  return 'neutral';
}

function SectionHeading({ icon: Icon, eyebrow, title, action }: { icon: typeof ShieldCheck; eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mono text-[9px] font-bold uppercase tracking-[.15em] text-primary">{eyebrow}</p>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-bold tracking-tight"><Icon size={18} className="text-primary" />{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Compliance() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState<number>();
  const [selectedProjectId, setSelectedProjectId] = useState<number>();
  const [selectedAgreementId, setSelectedAgreementId] = useState<number>();
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [showAgreementForm, setShowAgreementForm] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [showCloseoutForm, setShowCloseoutForm] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ companyName: '', tradeCapabilities: '', serviceAreas: '', primaryContact: '', email: '', phone: '' });
  const [documentForm, setDocumentForm] = useState({ documentType: 'insurance_certificate', title: '', projectId: '', expiresOn: '', objectPath: '' });
  const [requirementForm, setRequirementForm] = useState({ tradePartnerId: '', requirementType: 'insurance', title: '', dueDate: '', blocksAward: true, blocksMobilization: false, blocksBilling: false, blocksCloseout: false });
  const [agreementForm, setAgreementForm] = useState({ projectId: '', tradePartnerId: '', agreementNumber: '', scope: '', originalValue: '', retainagePercent: '10', paymentTerms: 'Net 30' });
  const [payForm, setPayForm] = useState({ applicationNumber: '', grossAmount: '', retainageAmount: '', storedMaterialsAmount: '', periodStart: '', periodEnd: '' });
  const [changeForm, setChangeForm] = useState({ changeNumber: '', title: '', proposedValue: '', description: '', scheduleImpactDays: '0' });
  const [closeoutForm, setCloseoutForm] = useState({ itemType: 'warranty', title: '', dueDate: '', notes: '' });

  const partnerQuery = useListTradePartners({ search: search || undefined }, { query: { queryKey: getListTradePartnersQueryKey({ search: search || undefined }) } });
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 60000 } });
  const detailQuery = useGetTradePartner(selectedPartnerId ?? 0, { query: { enabled: Boolean(selectedPartnerId), queryKey: getGetTradePartnerQueryKey(selectedPartnerId ?? 0) } });
  const requirementsQuery = useListProjectComplianceRequirements(selectedProjectId ?? 0, { query: { enabled: Boolean(selectedProjectId), queryKey: getListProjectComplianceRequirementsQueryKey(selectedProjectId ?? 0) } });
  const agreementsQuery = useListSubcontractAgreements(undefined, { query: { queryKey: getListSubcontractAgreementsQueryKey() } });
  const agreementQuery = useGetSubcontractAgreement(selectedAgreementId ?? 0, { query: { enabled: Boolean(selectedAgreementId), queryKey: getGetSubcontractAgreementQueryKey(selectedAgreementId ?? 0) } });

  const createPartner = useCreateTradePartner();
  const createDocument = useCreateTradePartnerComplianceDocument();
  const updateDocument = useUpdateTradePartnerComplianceDocument();
  const createRequirement = useCreateProjectComplianceRequirement();
  const createAgreement = useCreateSubcontractAgreement();
  const createPayApplication = useCreateSubcontractPayApplication();
  const createWaiver = useCreateSubcontractWaiver();
  const createChangeOrder = useCreateSubcontractChangeOrder();
  const createCloseout = useCreateSubcontractCloseoutItem();

  useEffect(() => {
    if (!selectedPartnerId && partnerQuery.data?.[0]) setSelectedPartnerId(partnerQuery.data[0].id);
  }, [partnerQuery.data, selectedPartnerId]);
  useEffect(() => {
    if (!selectedProjectId && projectsQuery.data?.[0]) setSelectedProjectId(projectsQuery.data[0].id);
  }, [projectsQuery.data, selectedProjectId]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['/api/trade-partners'] });
    qc.invalidateQueries({ queryKey: ['/api/subcontract-agreements'] });
    if (selectedPartnerId) qc.invalidateQueries({ queryKey: getGetTradePartnerQueryKey(selectedPartnerId) });
    if (selectedProjectId) qc.invalidateQueries({ queryKey: getListProjectComplianceRequirementsQueryKey(selectedProjectId) });
    if (selectedAgreementId) qc.invalidateQueries({ queryKey: getGetSubcontractAgreementQueryKey(selectedAgreementId) });
  };

  const summary = useMemo(() => {
    const partners = partnerQuery.data ?? [];
    return {
      partners: partners.length,
      blocked: partners.filter((partner) => !partner.gates.award || partner.gates.blockers.length > 0).length,
      expiring: partners.reduce((total, partner) => total + partner.complianceCounts.expired, 0),
      agreements: agreementsQuery.data?.length ?? 0,
    };
  }, [partnerQuery.data, agreementsQuery.data]);

  const selectedPartner = detailQuery.data?.partner;
  const canSubmitPartner = partnerForm.companyName.trim().length > 0;
  const summaryCards: { label: string; value: number; detail: string; Icon: LucideIcon; accent: string }[] = [
    { label: 'Trade partners', value: summary.partners, detail: 'Active directory', Icon: Building2, accent: 'teal' },
    { label: 'Award blockers', value: summary.blocked, detail: 'Qualification or compliance', Icon: AlertTriangle, accent: 'orange' },
    { label: 'Expired documents', value: summary.expiring, detail: 'Needs review', Icon: Clock3, accent: 'red' },
    { label: 'Subcontracts', value: summary.agreements, detail: 'In this environment', Icon: HandCoins, accent: 'green' },
  ];

  function submitPartner(event: React.FormEvent) {
    event.preventDefault();
    createPartner.mutate({
      data: {
        companyName: partnerForm.companyName,
        tradeCapabilities: partnerForm.tradeCapabilities.split(',').map((item) => item.trim()).filter(Boolean),
        serviceAreas: partnerForm.serviceAreas.split(',').map((item) => item.trim()).filter(Boolean),
        primaryContact: partnerForm.primaryContact || undefined,
        email: partnerForm.email || undefined,
        phone: partnerForm.phone || undefined,
      },
    }, {
      onSuccess: (partner) => {
        setSelectedPartnerId(partner.id);
        setPartnerForm({ companyName: '', tradeCapabilities: '', serviceAreas: '', primaryContact: '', email: '', phone: '' });
        setShowPartnerForm(false);
        refresh();
      },
    });
  }

  function submitDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPartnerId) return;
    createDocument.mutate({
      tradePartnerId: selectedPartnerId,
      data: {
        documentType: documentForm.documentType,
        title: documentForm.title,
        projectId: documentForm.projectId ? Number(documentForm.projectId) : undefined,
        expiresOn: documentForm.expiresOn || undefined,
        objectPath: documentForm.objectPath || undefined,
        status: documentForm.objectPath ? 'submitted' : 'requested',
      },
    }, { onSuccess: () => { setShowDocumentForm(false); setDocumentForm({ documentType: 'insurance_certificate', title: '', projectId: '', expiresOn: '', objectPath: '' }); refresh(); } });
  }

  function submitRequirement(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProjectId || !requirementForm.tradePartnerId) return;
    createRequirement.mutate({
      projectId: selectedProjectId,
      data: {
        tradePartnerId: Number(requirementForm.tradePartnerId),
        requirementType: requirementForm.requirementType,
        title: requirementForm.title,
        dueDate: requirementForm.dueDate || undefined,
        blocksAward: requirementForm.blocksAward,
        blocksMobilization: requirementForm.blocksMobilization,
        blocksBilling: requirementForm.blocksBilling,
        blocksCloseout: requirementForm.blocksCloseout,
      },
    }, { onSuccess: () => { setShowRequirementForm(false); setRequirementForm({ tradePartnerId: '', requirementType: 'insurance', title: '', dueDate: '', blocksAward: true, blocksMobilization: false, blocksBilling: false, blocksCloseout: false }); refresh(); } });
  }

  function submitAgreement(event: React.FormEvent) {
    event.preventDefault();
    if (!agreementForm.projectId || !agreementForm.tradePartnerId) return;
    createAgreement.mutate({
      projectId: Number(agreementForm.projectId),
      data: {
        tradePartnerId: Number(agreementForm.tradePartnerId),
        agreementNumber: agreementForm.agreementNumber,
        scope: agreementForm.scope,
        originalValue: Number(agreementForm.originalValue),
        retainagePercent: Number(agreementForm.retainagePercent),
        paymentTerms: agreementForm.paymentTerms || undefined,
        approvalStatus: 'draft',
      },
    }, { onSuccess: (agreement) => { setSelectedAgreementId(agreement.id); setShowAgreementForm(false); refresh(); } });
  }

  function submitPayApplication(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAgreementId) return;
    createPayApplication.mutate({
      agreementId: selectedAgreementId,
      data: {
        applicationNumber: payForm.applicationNumber,
        grossAmount: Number(payForm.grossAmount),
        retainageAmount: Number(payForm.retainageAmount || 0),
        storedMaterialsAmount: Number(payForm.storedMaterialsAmount || 0),
        periodStart: payForm.periodStart || undefined,
        periodEnd: payForm.periodEnd || undefined,
      },
    }, { onSuccess: () => { setShowPayForm(false); refresh(); } });
  }

  function renderError(mutation: { isError: boolean }) {
    return mutation.isError ? <p role="alert" className="text-xs text-destructive">The record could not be saved. Check the required fields and compliance gates.</p> : null;
  }

  return (
    <div className="animate-rise space-y-8">
      <PageTitle
        eyebrow="Risk, readiness, and cash flow"
        title="Trade partner compliance"
        description="Keep qualification, project gates, subcontract commitments, and payment rights connected from award through closeout."
        action={<Button onClick={() => setShowPartnerForm((value) => !value)}><Plus size={16} /> Add trade partner</Button>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ label, value, detail, Icon, accent }) => (
          <div key={String(label)} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <span className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</span>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent === 'red' ? 'bg-status-danger/10 text-status-danger' : accent === 'orange' ? 'bg-status-warning/10 text-status-warning' : accent === 'green' ? 'bg-status-success/10 text-status-success' : 'bg-primary/10 text-primary'}`}><Icon size={16} /></span>
            </div>
            <p className="mt-5 text-2xl font-bold tracking-[-.05em]">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
        ))}
      </section>

      {showPartnerForm && (
        <form onSubmit={submitPartner} className="rounded-xl border border-primary/25 bg-card p-5 shadow-sm">
          <SectionHeading icon={Building2} eyebrow="Directory" title="Add a trade partner" />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Company name *</span><Input autoFocus value={partnerForm.companyName} onChange={(event) => setPartnerForm({ ...partnerForm, companyName: event.target.value })} className={inputClass} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Trade capabilities</span><Input placeholder="Electrical, low voltage" value={partnerForm.tradeCapabilities} onChange={(event) => setPartnerForm({ ...partnerForm, tradeCapabilities: event.target.value })} className={inputClass} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Service areas</span><Input placeholder="Denver, Front Range" value={partnerForm.serviceAreas} onChange={(event) => setPartnerForm({ ...partnerForm, serviceAreas: event.target.value })} className={inputClass} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Primary contact</span><Input value={partnerForm.primaryContact} onChange={(event) => setPartnerForm({ ...partnerForm, primaryContact: event.target.value })} className={inputClass} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span><Input type="email" value={partnerForm.email} onChange={(event) => setPartnerForm({ ...partnerForm, email: event.target.value })} className={inputClass} /></label>
          </div>
          {renderError(createPartner)}
          <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setShowPartnerForm(false)}>Cancel</Button><Button type="submit" disabled={!canSubmitPartner || createPartner.isPending}>{createPartner.isPending ? 'Saving…' : 'Save trade partner'}</Button></div>
        </form>
      )}

      <section className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <div className="min-w-0 rounded-xl border border-border bg-card">
          <div className="border-b border-border p-4">
            <SectionHeading icon={Building2} eyebrow="Directory" title="Trade partners" action={<label className="relative block w-full sm:w-56"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search partners" className={`${inputClass} h-9 pl-8`} /></label>} />
          </div>
          {partnerQuery.isLoading ? <LoadingPanel lines={5} /> : partnerQuery.isError ? <ErrorPanel onRetry={() => partnerQuery.refetch()} /> : partnerQuery.data?.length ? (
            <div className="divide-y divide-border">
              {partnerQuery.data.map((partner) => (
                <button type="button" key={partner.id} onClick={() => setSelectedPartnerId(partner.id)} className={`flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/35 ${selectedPartnerId === partner.id ? 'bg-primary/5' : ''}`}>
                  <span className="min-w-0"><span className="block truncate text-sm font-bold">{partner.companyName}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{partner.tradeCapabilities.join(' · ') || 'Capabilities not added'}{partner.primaryContact ? ` · ${partner.primaryContact}` : ''}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><Badge tone={statusTone(partner.qualificationStatus)}>{partner.qualificationStatus}</Badge><span className="mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">{partner.complianceCounts.expired ? `${partner.complianceCounts.expired} expired` : `${partner.complianceCounts.approved}/${partner.complianceCounts.total} approved`}</span></span>
                </button>
              ))}
            </div>
          ) : <EmptyState icon={Building2} title="No trade partners yet" text="Add your first contractor, supplier, or specialty trade partner." />}
        </div>

        <div className="min-w-0 rounded-xl border border-border bg-card">
          <div className="border-b border-border p-4"><SectionHeading icon={ShieldCheck} eyebrow="Qualification" title={selectedPartner?.companyName ?? 'Select a partner'} action={selectedPartner ? <Button variant="outline" onClick={() => setShowDocumentForm((value) => !value)}><Plus size={15} /> Request document</Button> : undefined} /></div>
          {detailQuery.isLoading ? <LoadingPanel lines={5} /> : !selectedPartner ? <EmptyState icon={ShieldCheck} title="Choose a trade partner" text="Review documents, gates, and agreements from the directory." /> : (
            <div className="space-y-5 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {(['award', 'mobilization', 'billing', 'closeout'] as const).map((gate) => <div key={gate} className="flex items-center justify-between rounded-lg border border-border bg-secondary/25 px-3 py-2.5"><span className="mono text-[9px] font-bold uppercase tracking-[.1em] text-muted-foreground">{gate} gate</span>{selectedPartner.gates[gate] ? <CheckCircle2 size={16} className="text-status-success" /> : <XCircle size={16} className="text-status-danger" />}</div>)}
              </div>
              {selectedPartner.gates.blockers.length > 0 && <div className="rounded-lg border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning"><p className="font-bold">Action needed before work can move</p><ul className="mt-1 list-disc space-y-1 pl-4">{selectedPartner.gates.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
              <div>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">Compliance documents</h3><span className="mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">{detailQuery.data?.complianceDocuments.length ?? 0} tracked</span></div>
                <div className="space-y-2">
                  {(detailQuery.data?.complianceDocuments ?? []).map((document) => <div key={document.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"><span><span className="block text-xs font-bold">{document.title}</span><span className="mono mt-1 block text-[9px] uppercase tracking-[.08em] text-muted-foreground">{document.documentType.replace(/_/g, ' ')}{document.expiresOn ? ` · expires ${document.expiresOn}` : ''}</span></span><span className="flex items-center gap-2"><Badge tone={statusTone(document.status)}>{document.status}</Badge>{['submitted', 'approved', 'rejected'].includes(document.status) && <button type="button" className="text-[10px] font-bold text-primary hover:underline" onClick={() => updateDocument.mutate({ tradePartnerId: selectedPartner.id, documentId: document.id, data: { status: document.status === 'approved' ? 'rejected' : 'approved' } }, { onSuccess: refresh })}>{document.status === 'approved' ? 'Reject' : 'Approve'}</button>}</span></div>)}
                  {!detailQuery.data?.complianceDocuments.length && <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">No licenses, insurance, bonds, safety files, or prequalification documents have been requested.</p>}
                </div>
              </div>
              {showDocumentForm && <form onSubmit={submitDocument} className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3"><p className="text-xs font-bold">Request or submit a document</p><div className="grid gap-3 sm:grid-cols-2"><Input placeholder="Document title *" value={documentForm.title} onChange={(event) => setDocumentForm({ ...documentForm, title: event.target.value })} className={inputClass} /><select value={documentForm.documentType} onChange={(event) => setDocumentForm({ ...documentForm, documentType: event.target.value })} className={inputClass}><option value="insurance_certificate">Insurance certificate</option><option value="license">License</option><option value="bond">Bond</option><option value="safety_information">Safety information</option><option value="financial_prequalification">Financial / prequalification</option><option value="reference">Reference</option></select><Input type="date" aria-label="Expiration date" value={documentForm.expiresOn} onChange={(event) => setDocumentForm({ ...documentForm, expiresOn: event.target.value })} className={inputClass} /><Input placeholder="Protected object path (optional)" value={documentForm.objectPath} onChange={(event) => setDocumentForm({ ...documentForm, objectPath: event.target.value })} className={inputClass} /></div>{renderError(createDocument)}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setShowDocumentForm(false)}>Cancel</Button><Button type="submit" disabled={!documentForm.title.trim() || createDocument.isPending}>Save request</Button></div></form>}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <SectionHeading icon={ClipboardCheck} eyebrow="Project controls" title="Compliance gates" action={<Button variant="outline" onClick={() => setShowRequirementForm((value) => !value)} disabled={!selectedProjectId}><Plus size={15} /> Add project requirement</Button>} />
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center"><label className="text-xs font-semibold text-muted-foreground">Project<select value={selectedProjectId ?? ''} onChange={(event) => setSelectedProjectId(Number(event.target.value))} className={`ml-2 min-w-[220px] ${inputClass}`}><option value="">Select project</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.projectName}</option>)}</select></label><span className="text-xs text-muted-foreground">Gates can stop award, mobilization, billing, or closeout until reviewed.</span></div>
        {showRequirementForm && <form onSubmit={submitRequirement} className="mb-4 grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 md:grid-cols-2"><select aria-label="Trade partner" value={requirementForm.tradePartnerId} onChange={(event) => setRequirementForm({ ...requirementForm, tradePartnerId: event.target.value })} className={inputClass}><option value="">Trade partner *</option>{(partnerQuery.data ?? []).map((partner) => <option key={partner.id} value={partner.id}>{partner.companyName}</option>)}</select><Input placeholder="Requirement title *" value={requirementForm.title} onChange={(event) => setRequirementForm({ ...requirementForm, title: event.target.value })} className={inputClass} /><Input placeholder="Requirement type" value={requirementForm.requirementType} onChange={(event) => setRequirementForm({ ...requirementForm, requirementType: event.target.value })} className={inputClass} /><Input type="date" aria-label="Due date" value={requirementForm.dueDate} onChange={(event) => setRequirementForm({ ...requirementForm, dueDate: event.target.value })} className={inputClass} /><div className="flex flex-wrap gap-3 text-xs font-semibold text-muted-foreground md:col-span-2">{[['blocksAward', 'Award'], ['blocksMobilization', 'Mobilization'], ['blocksBilling', 'Billing'], ['blocksCloseout', 'Closeout']].map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={requirementForm[key as keyof typeof requirementForm] as boolean} onChange={(event) => setRequirementForm({ ...requirementForm, [key]: event.target.checked })} />{label}</label>)}</div><div className="flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={() => setShowRequirementForm(false)}>Cancel</Button><Button type="submit" disabled={!requirementForm.tradePartnerId || !requirementForm.title.trim()}>Save requirement</Button></div></form>}
        {!selectedProjectId ? <EmptyState icon={ClipboardCheck} title="Select a project" text="Project-specific requirements and gates appear here." /> : requirementsQuery.isLoading ? <LoadingPanel lines={3} /> : requirementsQuery.data?.length ? <div className="grid gap-3 md:grid-cols-2">{requirementsQuery.data.map((requirement) => <div key={requirement.id} className="rounded-lg border border-border p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold">{requirement.title}</p><p className="mono mt-1 text-[9px] uppercase tracking-[.08em] text-muted-foreground">{partnerQuery.data?.find((partner) => partner.id === requirement.tradePartnerId)?.companyName ?? 'Trade partner'}{requirement.dueDate ? ` · due ${requirement.dueDate}` : ''}</p></div><Badge tone={statusTone(requirement.status)}>{requirement.status}</Badge></div><div className="mt-3 flex flex-wrap gap-1.5">{requirement.blocksAward && <Badge tone="orange">award</Badge>}{requirement.blocksMobilization && <Badge tone="orange">mobilization</Badge>}{requirement.blocksBilling && <Badge tone="orange">billing</Badge>}{requirement.blocksCloseout && <Badge tone="orange">closeout</Badge>}</div></div>)}</div> : <EmptyState icon={ClipboardCheck} title="No requirements for this project" text="Add the documents and approvals that must be complete before work or payment moves." />}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <SectionHeading icon={HandCoins} eyebrow="Commitments and payments" title="Subcontract agreements" action={<Button onClick={() => setShowAgreementForm((value) => !value)}><Plus size={15} /> New subcontract</Button>} />
        {showAgreementForm && <form onSubmit={submitAgreement} className="mb-5 grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 md:grid-cols-2"><select aria-label="Agreement project" value={agreementForm.projectId} onChange={(event) => setAgreementForm({ ...agreementForm, projectId: event.target.value })} className={inputClass}><option value="">Project *</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.projectName}</option>)}</select><select aria-label="Agreement trade partner" value={agreementForm.tradePartnerId} onChange={(event) => setAgreementForm({ ...agreementForm, tradePartnerId: event.target.value })} className={inputClass}><option value="">Trade partner *</option>{(partnerQuery.data ?? []).map((partner) => <option key={partner.id} value={partner.id}>{partner.companyName}</option>)}</select><Input placeholder="Agreement number *" value={agreementForm.agreementNumber} onChange={(event) => setAgreementForm({ ...agreementForm, agreementNumber: event.target.value })} className={inputClass} /><Input type="number" min="0" placeholder="Original value *" value={agreementForm.originalValue} onChange={(event) => setAgreementForm({ ...agreementForm, originalValue: event.target.value })} className={inputClass} /><Input placeholder="Scope of work *" value={agreementForm.scope} onChange={(event) => setAgreementForm({ ...agreementForm, scope: event.target.value })} className={inputClass} /><div className="flex gap-3"><Input type="number" min="0" max="100" placeholder="Retainage %" value={agreementForm.retainagePercent} onChange={(event) => setAgreementForm({ ...agreementForm, retainagePercent: event.target.value })} className={inputClass} /><Input placeholder="Payment terms" value={agreementForm.paymentTerms} onChange={(event) => setAgreementForm({ ...agreementForm, paymentTerms: event.target.value })} className={inputClass} /></div><div className="flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={() => setShowAgreementForm(false)}>Cancel</Button><Button type="submit" disabled={!agreementForm.projectId || !agreementForm.tradePartnerId || !agreementForm.agreementNumber || !agreementForm.scope || !agreementForm.originalValue}>Create subcontract</Button></div>{renderError(createAgreement)}</form>}
        {agreementsQuery.isLoading ? <LoadingPanel lines={3} /> : agreementsQuery.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{agreementsQuery.data.map((agreement) => <button key={agreement.id} type="button" onClick={() => setSelectedAgreementId(agreement.id)} className={`rounded-lg border p-4 text-left transition-colors hover:border-primary/40 ${selectedAgreementId === agreement.id ? 'border-primary bg-primary/5' : 'border-border'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{agreement.tradePartnerName}</p><p className="mono mt-1 text-[9px] uppercase tracking-[.08em] text-muted-foreground">{agreement.agreementNumber} · {agreement.scope}</p></div><Badge tone={statusTone(agreement.approvalStatus)}>{agreement.approvalStatus}</Badge></div><div className="mt-4 flex items-center justify-between text-xs"><span className="text-muted-foreground">Current commitment</span><span className="font-bold">{money(agreement.currentValue)}</span></div></button>)}</div> : <EmptyState icon={HandCoins} title="No subcontracts yet" text="Create a subcontract after the trade partner passes the award gate." />}
        {agreementQuery.data && <div className="mt-5 border-t border-border pt-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="mono text-[9px] font-bold uppercase tracking-[.13em] text-primary">{agreementQuery.data.agreementNumber}</p><h3 className="mt-1 text-lg font-bold">{agreementQuery.data.tradePartnerName}</h3><p className="mt-1 text-xs text-muted-foreground">{agreementQuery.data.scope} · {money(agreementQuery.data.currentValue)} · {agreementQuery.data.retainagePercent}% retainage</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShowPayForm((value) => !value)}><Plus size={14} /> Pay application</Button><Button variant="outline" onClick={() => setShowChangeForm((value) => !value)}><Plus size={14} /> Change order</Button><Button variant="outline" onClick={() => setShowCloseoutForm((value) => !value)}><Plus size={14} /> Closeout item</Button></div></div>
          {showPayForm && <form onSubmit={submitPayApplication} className="mt-4 grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 md:grid-cols-3"><Input placeholder="Application # *" value={payForm.applicationNumber} onChange={(event) => setPayForm({ ...payForm, applicationNumber: event.target.value })} className={inputClass} /><Input type="number" min="0" placeholder="Gross amount *" value={payForm.grossAmount} onChange={(event) => setPayForm({ ...payForm, grossAmount: event.target.value })} className={inputClass} /><Input type="number" min="0" placeholder="Retainage amount" value={payForm.retainageAmount} onChange={(event) => setPayForm({ ...payForm, retainageAmount: event.target.value })} className={inputClass} /><Input type="number" min="0" placeholder="Stored materials" value={payForm.storedMaterialsAmount} onChange={(event) => setPayForm({ ...payForm, storedMaterialsAmount: event.target.value })} className={inputClass} /><Input type="date" aria-label="Period start" value={payForm.periodStart} onChange={(event) => setPayForm({ ...payForm, periodStart: event.target.value })} className={inputClass} /><Input type="date" aria-label="Period end" value={payForm.periodEnd} onChange={(event) => setPayForm({ ...payForm, periodEnd: event.target.value })} className={inputClass} /><div className="flex justify-end gap-2 md:col-span-3"><Button type="button" variant="ghost" onClick={() => setShowPayForm(false)}>Cancel</Button><Button type="submit" disabled={!payForm.applicationNumber || !payForm.grossAmount}>Submit pay application</Button></div>{renderError(createPayApplication)}</form>}
          {showChangeForm && <form onSubmit={(event) => { event.preventDefault(); createChangeOrder.mutate({ agreementId: agreementQuery.data.id, data: { changeNumber: changeForm.changeNumber, title: changeForm.title, proposedValue: Number(changeForm.proposedValue), description: changeForm.description || undefined, scheduleImpactDays: Number(changeForm.scheduleImpactDays || 0) } }, { onSuccess: () => { setShowChangeForm(false); refresh(); } }); }} className="mt-4 grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 md:grid-cols-2"><Input placeholder="Change # *" value={changeForm.changeNumber} onChange={(event) => setChangeForm({ ...changeForm, changeNumber: event.target.value })} className={inputClass} /><Input placeholder="Title *" value={changeForm.title} onChange={(event) => setChangeForm({ ...changeForm, title: event.target.value })} className={inputClass} /><Input type="number" min="0" placeholder="Proposed value *" value={changeForm.proposedValue} onChange={(event) => setChangeForm({ ...changeForm, proposedValue: event.target.value })} className={inputClass} /><Input type="number" min="0" placeholder="Schedule impact days" value={changeForm.scheduleImpactDays} onChange={(event) => setChangeForm({ ...changeForm, scheduleImpactDays: event.target.value })} className={inputClass} /><Input placeholder="Description" value={changeForm.description} onChange={(event) => setChangeForm({ ...changeForm, description: event.target.value })} className={`${inputClass} md:col-span-2`} /><div className="flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={() => setShowChangeForm(false)}>Cancel</Button><Button type="submit" disabled={!changeForm.changeNumber || !changeForm.title || !changeForm.proposedValue}>Submit change order</Button></div>{renderError(createChangeOrder)}</form>}
          {showCloseoutForm && <form onSubmit={(event) => { event.preventDefault(); createCloseout.mutate({ agreementId: agreementQuery.data.id, data: { itemType: closeoutForm.itemType as 'warranty' | 'as_built' | 'operations_manual' | 'final_release' | 'other', title: closeoutForm.title, dueDate: closeoutForm.dueDate || undefined, notes: closeoutForm.notes || undefined } }, { onSuccess: () => { setShowCloseoutForm(false); refresh(); } }); }} className="mt-4 grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 md:grid-cols-2"><select aria-label="Closeout item type" value={closeoutForm.itemType} onChange={(event) => setCloseoutForm({ ...closeoutForm, itemType: event.target.value })} className={inputClass}><option value="warranty">Warranty</option><option value="as_built">As-built</option><option value="operations_manual">O&M manual</option><option value="final_release">Final release</option><option value="other">Other</option></select><Input placeholder="Item title *" value={closeoutForm.title} onChange={(event) => setCloseoutForm({ ...closeoutForm, title: event.target.value })} className={inputClass} /><Input type="date" aria-label="Due date" value={closeoutForm.dueDate} onChange={(event) => setCloseoutForm({ ...closeoutForm, dueDate: event.target.value })} className={inputClass} /><Input placeholder="Notes" value={closeoutForm.notes} onChange={(event) => setCloseoutForm({ ...closeoutForm, notes: event.target.value })} className={inputClass} /><div className="flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={() => setShowCloseoutForm(false)}>Cancel</Button><Button type="submit" disabled={!closeoutForm.title}>Add closeout item</Button></div>{renderError(createCloseout)}</form>}
          <div className="mt-5 grid gap-4 lg:grid-cols-3"><div><h4 className="mb-2 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Pay applications</h4>{agreementQuery.data.payApplications.length ? <div className="space-y-2">{agreementQuery.data.payApplications.map((application) => <div key={application.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between"><span className="text-xs font-bold">Application {application.applicationNumber}</span><Badge tone={statusTone(application.status)}>{application.status}</Badge></div><p className="mt-2 text-sm font-bold">{money(application.netAmount)} net</p><p className="mt-1 text-[10px] text-muted-foreground">{application.waiverStatus === 'missing' ? 'Waiver missing' : `${application.waiverStatus} waiver`}</p><button type="button" className="mt-2 text-[10px] font-bold text-primary hover:underline" onClick={() => createWaiver.mutate({ applicationId: application.id, data: { waiverType: 'conditional', status: 'submitted' } }, { onSuccess: refresh })}>Record conditional waiver</button></div>)}</div> : <p className="text-xs text-muted-foreground">No applications submitted.</p>}</div><div><h4 className="mb-2 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Change orders</h4>{agreementQuery.data.changeOrders.length ? <div className="space-y-2">{agreementQuery.data.changeOrders.map((change) => <div key={change.id} className="flex items-center justify-between rounded-lg border border-border p-3"><span><span className="block text-xs font-bold">{change.changeNumber} · {change.title}</span><span className="text-[10px] text-muted-foreground">{money(change.proposedValue)}</span></span><Badge tone={statusTone(change.approvalStatus)}>{change.approvalStatus}</Badge></div>)}</div> : <p className="text-xs text-muted-foreground">No change orders submitted.</p>}</div><div><h4 className="mb-2 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Closeout accountability</h4>{agreementQuery.data.closeoutItems.length ? <div className="space-y-2">{agreementQuery.data.closeoutItems.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-3"><span><span className="block text-xs font-bold">{item.title}</span><span className="mono text-[9px] uppercase text-muted-foreground">{item.itemType.replace(/_/g, ' ')}{item.dueDate ? ` · due ${item.dueDate}` : ''}</span></span><Badge tone={statusTone(item.status)}>{item.status}</Badge></div>)}</div> : <p className="text-xs text-muted-foreground">No closeout requirements yet.</p>}</div></div>
        </div>}
      </section>
    </div>
  );
}