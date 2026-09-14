import { useMemo, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Bid,
  BidProposalAttachment,
  BidProposalAttachmentConversionStatus,
  BidProposalAttachmentPurpose,
  useCreateBidAttachment,
  useDeleteBidProposalAttachment,
  useListBidAttachments,
  useListProjects,
  useSeedSubmittalRegisterFromBid,
  useUpdateBidProposalAttachment,
  getListBidAttachmentsQueryKey,
  getListProjectsQueryKey,
} from '@workspace/api-client-react';
import { Badge, Button, ErrorPanel, LoadingPanel, Modal } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';

const purposes: { value: BidProposalAttachmentPurpose; label: string }[] = [
  { value: 'qualification', label: 'Qualification' },
  { value: 'scope_inclusion', label: 'Scope inclusion' },
  { value: 'assumption', label: 'Assumption' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'alternate', label: 'Alternate' },
  { value: 'substitution_request', label: 'Substitution request / or equal' },
  { value: 'requested_product_data', label: 'Requested product data' },
  { value: 'other', label: 'Other proposal attachment' },
];
const conversionStatuses: { value: BidProposalAttachmentConversionStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'converted', label: 'Converted to submittal' },
];
const convertiblePurposes = new Set<BidProposalAttachmentPurpose>(['alternate', 'substitution_request', 'requested_product_data']);
const emptyDraft = {
  purpose: 'other' as BidProposalAttachmentPurpose,
  title: '',
  description: '',
  documentName: '',
  documentUrl: '',
  integrationProviderKey: '',
  externalReference: '',
  conversionStatus: 'open' as BidProposalAttachmentConversionStatus,
};

function tone(status: string) {
  return status === 'converted' ? 'green' as const : status === 'accepted' ? 'teal' as const : status === 'rejected' ? 'red' as const : 'neutral' as const;
}

function AttachmentForm({
  attachment,
  onClose,
  onSaved,
  bidId,
}: {
  attachment?: BidProposalAttachment;
  onClose: () => void;
  onSaved: () => void;
  bidId: number;
}) {
  const [draft, setDraft] = useState(() => attachment ? {
    purpose: attachment.purpose,
    title: attachment.title,
    description: attachment.description ?? '',
    documentName: attachment.documentName ?? '',
    documentUrl: attachment.documentUrl ?? '',
    integrationProviderKey: attachment.integrationProviderKey ?? '',
    externalReference: attachment.externalReference ?? '',
    conversionStatus: attachment.conversionStatus,
  } : emptyDraft);
  const create = useCreateBidAttachment();
  const update = useUpdateBidProposalAttachment();
  const pending = create.isPending || update.isPending;
  const set = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const data = {
      purpose: draft.purpose,
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      documentName: draft.documentName.trim() || undefined,
      documentUrl: draft.documentUrl.trim() || undefined,
      integrationProviderKey: draft.integrationProviderKey.trim() || undefined,
      externalReference: draft.externalReference.trim() || undefined,
      conversionStatus: draft.conversionStatus,
    };
    if (!data.title) return;
    const onSuccess = () => onSaved();
    if (attachment) update.mutate({ attachmentId: attachment.id, data }, { onSuccess });
    else create.mutate({ bidId, data }, { onSuccess });
  };
  return <Modal title={attachment ? 'Edit bid-stage attachment' : 'Add bid-stage attachment'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs leading-5 text-muted-foreground">
        This is a bid/proposal record. Formal construction submittals are normally created after award under the project.
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Purpose</span><Select value={draft.purpose} onValueChange={(value) => set('purpose', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{purposes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>
        <label className="block md:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Title</span><Input required value={draft.title} onChange={(event) => set('title', event.target.value)} placeholder="Manufacturer substitution request — storefront system" /></label>
        <label className="block md:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><Textarea rows={3} value={draft.description} onChange={(event) => set('description', event.target.value)} placeholder="What was included, excluded, assumed, or requested?" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Document name</span><Input value={draft.documentName} onChange={(event) => set('documentName', event.target.value)} placeholder="proposal-attachment.pdf" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Document or source URL</span><Input type="url" value={draft.documentUrl} onChange={(event) => set('documentUrl', event.target.value)} placeholder="https://..." /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Provider key (optional)</span><Input value={draft.integrationProviderKey} onChange={(event) => set('integrationProviderKey', event.target.value)} placeholder="document_system" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">External reference (optional)</span><Input value={draft.externalReference} onChange={(event) => set('externalReference', event.target.value)} placeholder="RFQ-1042" /></label>
        {attachment && <label className="block md:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Conversion status</span><Select value={draft.conversionStatus} onValueChange={(value) => set('conversionStatus', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{conversionStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>}
      </div>
      {(create.isError || update.isError) && <p role="alert" className="text-xs text-destructive">The bid-stage attachment could not be saved.</p>}
      <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !draft.title.trim()}>{pending ? 'Saving…' : attachment ? 'Save attachment' : 'Add attachment'}</Button></div>
    </form>
  </Modal>;
}

function SeedRegisterModal({ bid, attachments, onClose }: { bid: Bid; attachments: BidProposalAttachment[]; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 60000 } });
  const seed = useSeedSubmittalRegisterFromBid();
  const eligible = attachments.filter((attachment) => convertiblePurposes.has(attachment.purpose) && attachment.conversionStatus === 'accepted');
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState(`Accepted commitments — ${bid.name}`);
  const [selectedIds, setSelectedIds] = useState<number[]>(eligible.map((attachment) => attachment.id));
  const toggle = (id: number) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!projectId || !name.trim() || selectedIds.length === 0) return;
    seed.mutate({ data: { bidId: bid.id, projectId: Number(projectId), attachmentIds: selectedIds, name: name.trim(), originType: selectedIds.some((id) => attachments.find((item) => item.id === id)?.purpose === 'substitution_request') ? 'accepted_substitution' : 'accepted_alternate' } }, {
      onSuccess: (created) => { onClose(); setLocation(`/submittals/${created.id}`); },
    });
  };
  return <Modal title="Seed post-award submittal register" onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">This creates a project-level package and one linked item per accepted bid commitment. The original bid attachments stay in the bid history.</p>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Awarded project</span><Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue placeholder={projectsQuery.isLoading ? 'Loading projects…' : 'Select project'} /></SelectTrigger><SelectContent className="bg-popover">{(projectsQuery.data ?? []).map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.projectNumber} · {project.projectName}</SelectItem>)}</SelectContent></Select></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Package name</span><Input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div><p className="mb-2 text-xs font-semibold text-muted-foreground">Accepted commitments to convert</p><div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border p-3">{eligible.length === 0 ? <p className="text-xs text-muted-foreground">No accepted alternates, substitution requests, or requested product data remain on this bid.</p> : eligible.map((attachment) => <label key={attachment.id} className="flex items-start gap-3 rounded-md p-2 hover:bg-secondary/50"><input type="checkbox" checked={selectedIds.includes(attachment.id)} onChange={() => toggle(attachment.id)} className="mt-1" /><span className="min-w-0"><span className="block text-sm font-semibold">{attachment.title}</span><span className="block text-xs text-muted-foreground">{purposes.find((item) => item.value === attachment.purpose)?.label}</span></span></label>)}</div></div>
      {seed.isError && <p role="alert" className="text-xs text-destructive">The register could not be seeded. Confirm the bid is awarded and the project is in this environment.</p>}
      <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={seed.isPending || !projectId || !name.trim() || selectedIds.length === 0 || eligible.length === 0}>{seed.isPending ? 'Creating…' : 'Create post-award register'}</Button></div>
    </form>
  </Modal>;
}

export function BidAttachmentsPanel({ bid, canEdit }: { bid: Bid; canEdit: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BidProposalAttachment>();
  const [showSeed, setShowSeed] = useState(false);
  const attachmentsQuery = useListBidAttachments(bid.id, { query: { queryKey: getListBidAttachmentsQueryKey(bid.id) } });
  const remove = useDeleteBidProposalAttachment();
  const attachments = attachmentsQuery.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: getListBidAttachmentsQueryKey(bid.id) });
  const canSeed = bid.stage === 'awarded' && attachments.some((attachment) => convertiblePurposes.has(attachment.purpose) && attachment.conversionStatus === 'accepted');
  return <section className="mt-5 rounded-xl border border-border bg-card p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Bid-stage proposal attachments</p><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Qualifications, inclusions, assumptions, exclusions, alternates, substitution requests, and requested product data stay attached to this bid. Formal construction submittals belong to the awarded project.</p></div><div className="flex flex-wrap gap-2">{bid.stage === 'awarded' && <Button variant="outline" disabled={!canSeed} onClick={() => setShowSeed(true)}>Seed post-award register</Button>}{canEdit && <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={15} /> Add attachment</Button>}</div></div>
    {attachmentsQuery.isLoading ? <LoadingPanel lines={3} /> : attachmentsQuery.isError ? <ErrorPanel onRetry={() => attachmentsQuery.refetch()} /> : attachments.length === 0 ? <div className="rounded-lg border border-dashed border-border p-5 text-center"><FileText className="mx-auto mb-2 text-muted-foreground" size={20} /><p className="text-sm font-semibold">No bid-stage attachments yet</p><p className="mt-1 text-xs text-muted-foreground">Use this record for proposal evidence and accepted exceptions before award.</p></div> : <div className="space-y-3">{attachments.map((attachment) => <div key={attachment.id} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{attachment.title}</h3><Badge tone="neutral">{purposes.find((item) => item.value === attachment.purpose)?.label}</Badge><Badge tone={tone(attachment.conversionStatus)}>{conversionStatuses.find((item) => item.value === attachment.conversionStatus)?.label}</Badge></div>{attachment.description && <p className="mt-2 text-xs leading-5 text-muted-foreground">{attachment.description}</p>}<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{attachment.documentName && <span>{attachment.documentName}</span>}{attachment.externalReference && <span>Ref {attachment.externalReference}</span>}{attachment.documentUrl && <a href={attachment.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Open source <ExternalLink size={12} /></a>}</div></div>{canEdit && <div className="flex gap-1"><Button variant="ghost" className="p-2" aria-label={`Edit ${attachment.title}`} onClick={() => { setEditing(attachment); setShowForm(true); }}><Pencil size={15} /></Button><Button variant="ghost" className="p-2" aria-label={`Delete ${attachment.title}`} onClick={() => { if (window.confirm(`Delete ${attachment.title}?`)) remove.mutate({ attachmentId: attachment.id }, { onSuccess: refresh }); }}><Trash2 size={15} /></Button></div>}</div></div>)}</div>}
    {showForm && <AttachmentForm bidId={bid.id} attachment={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} onSaved={() => { setShowForm(false); setEditing(undefined); refresh(); }} />}
    {showSeed && <SeedRegisterModal bid={bid} attachments={attachments} onClose={() => setShowSeed(false)} />}
  </section>;
}