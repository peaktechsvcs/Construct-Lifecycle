import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ClipboardCheck, Download, ExternalLink, FileText, Layers3, Link2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import {
  buildSubmittalPackageAssembly,
  reorderSubmittalDocumentPages,
  reorderSubmittalItems,
  SubmittalCoordination,
  SubmittalCoordinationStatus,
  SubmittalCoordinationType,
  SubmittalItemType,
  SubmittalItemStatus,
  SubmittalOriginType,
  SubmittalDocument,
  SubmittalPackage,
  SubmittalPackageStatus,
  useCreateSubmittalItem,
  useCreateSubmittalPackage,
  useCreateSubmittalRevision,
  useDeleteSubmittalItem,
  useDeleteSubmittalDocument,
  useDeleteSubmittalPackage,
  useRequestSubmittalDocumentUpload,
  useCompleteSubmittalDocumentUpload,
  useCreateSubmittalCoordination,
  useGetSubmittalPackage,
  useListSubmittalCoordination,
  useListBids,
  useListProjects,
  useListSubmittalPackages,
  useUpdateSubmittalPackage,
  useUpdateSubmittalCoordination,
  useDeleteSubmittalCoordination,
  getGetSubmittalPackageQueryKey,
  getListBidsQueryKey,
  getListProjectsQueryKey,
  getListSubmittalPackagesQueryKey,
  getListSubmittalCoordinationQueryKey,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';

const packageStatuses: { value: SubmittalPackageStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'approved_as_noted', label: 'Approved as noted' },
  { value: 'revise_and_resubmit', label: 'Revise and resubmit' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'superseded', label: 'Superseded' },
];
const originTypes: { value: SubmittalOriginType; label: string }[] = [
  { value: 'contract', label: 'Contract requirement' },
  { value: 'accepted_substitution', label: 'Accepted substitution' },
  { value: 'accepted_alternate', label: 'Accepted alternate' },
  { value: 'early_procurement', label: 'Early procurement' },
];
const itemTypes: { value: SubmittalItemType; label: string }[] = [
  { value: 'shop_drawing', label: 'Shop drawing' },
  { value: 'product_data', label: 'Product data' },
  { value: 'sample', label: 'Sample' },
  { value: 'mockup', label: 'Mockup' },
  { value: 'calculation', label: 'Calculation' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'closeout', label: 'Closeout' },
  { value: 'other', label: 'Other' },
];
const itemStatuses: { value: SubmittalItemStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'included', label: 'Included' },
  { value: 'needs_revision', label: 'Needs revision' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'superseded', label: 'Superseded' },
];
const coordinationTypes: { value: SubmittalCoordinationType; label: string }[] = [
  { value: 'procurement', label: 'Procurement' },
  { value: 'fabrication', label: 'Fabrication' },
  { value: 'installation', label: 'Installation' },
  { value: 'schedule', label: 'Project schedule' },
];
const coordinationStatuses: { value: SubmittalCoordinationStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];
const label = (items: { value: string; label: string }[], value: string) => items.find((item) => item.value === value)?.label ?? value;
const tone = (status: string) => {
  if (status === 'approved' || status === 'approved_as_noted' || status === 'accepted') return 'green' as const;
  if (status === 'rejected' || status === 'superseded') return 'red' as const;
  if (status === 'under_review' || status === 'submitted' || status === 'revise_and_resubmit') return 'violet' as const;
  return 'neutral' as const;
};

type PackageFormState = {
  projectId: string;
  sourceBidId: string;
  originType: SubmittalOriginType;
  name: string;
  description: string;
  specificationSection: string;
  responsibleParty: string;
  status: SubmittalPackageStatus;
  dueDate: string;
};
const emptyPackageForm: PackageFormState = {
  projectId: '', sourceBidId: '', originType: 'contract', name: '', description: '',
  specificationSection: '', responsibleParty: '', status: 'draft', dueDate: '',
};
const packageToForm = (item?: SubmittalPackage): PackageFormState => item ? {
  projectId: String(item.projectId),
  sourceBidId: item.sourceBidId ? String(item.sourceBidId) : '',
  originType: item.originType,
  name: item.name,
  description: item.description ?? '',
  specificationSection: item.specificationSection ?? '',
  responsibleParty: item.responsibleParty ?? '',
  status: item.status,
  dueDate: item.dueDate?.slice(0, 10) ?? '',
} : emptyPackageForm;

function PackageForm({ item, onClose, onSaved }: { item?: SubmittalPackage; onClose: () => void; onSaved: (id: number) => void }) {
  const [form, setForm] = useState<PackageFormState>(() => packageToForm(item));
  const projects = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 60000 } });
  const bids = useListBids(undefined, { query: { queryKey: getListBidsQueryKey(), staleTime: 60000 } });
  const create = useCreateSubmittalPackage();
  const update = useUpdateSubmittalPackage();
  const set = <K extends keyof PackageFormState>(key: K, value: PackageFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const data = {
      sourceBidId: form.sourceBidId ? Number(form.sourceBidId) : undefined,
      originType: form.originType,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      specificationSection: form.specificationSection.trim() || undefined,
      responsibleParty: form.responsibleParty.trim() || undefined,
      status: form.status,
      dueDate: form.dueDate || undefined,
    };
    if (item) {
      update.mutate({ submittalId: item.id, data }, { onSuccess: () => onSaved(item.id) });
    } else if (form.projectId) {
      create.mutate({ data: { ...data, projectId: Number(form.projectId) } }, { onSuccess: (created) => onSaved(created.id) });
    }
  };
  const pending = create.isPending || update.isPending;
  return (
    <Modal title={item ? 'Edit submittal package' : 'New submittal package'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        {!item && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Awarded project</span><Select value={form.projectId} onValueChange={(value) => set('projectId', value)}><SelectTrigger aria-label="Awarded project"><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent className="bg-popover">{(projects.data ?? []).map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.projectNumber} · {project.projectName}</SelectItem>)}</SelectContent></Select></label>}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Package name</span><Input required value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="HVAC equipment product data" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Specification section</span><Input value={form.specificationSection} onChange={(event) => set('specificationSection', event.target.value)} placeholder="23 05 00" /></label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Origin</span><Select value={form.originType} onValueChange={(value) => set('originType', value as SubmittalOriginType)}><SelectTrigger aria-label="Submittal origin"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{originTypes.map((origin) => <SelectItem key={origin.value} value={origin.value}>{origin.label}</SelectItem>)}</SelectContent></Select></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Status</span><Select value={form.status} onValueChange={(value) => set('status', value as SubmittalPackageStatus)}><SelectTrigger aria-label="Submittal status"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{packageStatuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent></Select></label>
        </div>
        {!item && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Linked bid or accepted substitution</span><Select value={form.sourceBidId || 'none'} onValueChange={(value) => set('sourceBidId', value === 'none' ? '' : value)}><SelectTrigger aria-label="Source bid"><SelectValue placeholder="No source bid" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="none">No source bid</SelectItem>{(bids.data ?? []).map((bid) => <SelectItem key={bid.id} value={String(bid.id)}>{bid.bidNumber} · {bid.name}</SelectItem>)}</SelectContent></Select></label>}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Responsible party</span><Input value={form.responsibleParty} onChange={(event) => set('responsibleParty', event.target.value)} placeholder="Mechanical subcontractor" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Required by</span><Input type="date" value={form.dueDate} onChange={(event) => set('dueDate', event.target.value)} /></label>
        </div>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Notes</span><Textarea rows={4} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="Scope, review expectations, and coordination notes" /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || (!item && !form.projectId)}>{pending ? 'Saving…' : item ? 'Save changes' : 'Create package'}</Button></div>
      </form>
    </Modal>
  );
}

function ItemForm({ packageId, onClose, onSaved }: { packageId: number; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ itemType: 'product_data' as SubmittalItemType, name: '', description: '', status: 'pending' as SubmittalItemStatus, documentName: '', documentUrl: '' });
  const create = useCreateSubmittalItem();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ submittalId: packageId, data: { ...form, description: form.description.trim() || undefined, documentName: form.documentName.trim() || undefined, documentUrl: form.documentUrl.trim() || undefined } }, { onSuccess: onSaved });
  };
  return <Modal title="Add package item" onClose={onClose}><form className="space-y-4" onSubmit={submit}>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Item name</span><Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="AHU-1 equipment schedule" /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Type</span><Select value={form.itemType} onValueChange={(value) => setForm({ ...form, itemType: value as SubmittalItemType })}><SelectTrigger aria-label="Submittal item type"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{itemTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></label>
    </div>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Item status</span><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as SubmittalItemStatus })}><SelectTrigger aria-label="Submittal item status"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{itemStatuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent></Select></label>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><Textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What the reviewer should verify" /></label>
    <div className="grid gap-4 md:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Document name</span><Input value={form.documentName} onChange={(event) => setForm({ ...form, documentName: event.target.value })} placeholder="AHU-1-product-data.pdf" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Document link</span><Input type="url" value={form.documentUrl} onChange={(event) => setForm({ ...form, documentUrl: event.target.value })} placeholder="https://..." /></label></div>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={create.isPending || !form.name.trim()}>{create.isPending ? 'Adding…' : 'Add item'}</Button></div>
  </form></Modal>;
}

function RevisionForm({ packageId, onClose, onSaved }: { packageId: number; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ status: 'submitted' as SubmittalPackageStatus, reviewerName: '', reviewComments: '' });
  const create = useCreateSubmittalRevision();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ submittalId: packageId, data: { ...form, reviewerName: form.reviewerName.trim() || undefined, reviewComments: form.reviewComments.trim() || undefined } }, { onSuccess: onSaved });
  };
  return <Modal title="Record revision or review" onClose={onClose}><form className="space-y-4" onSubmit={submit}>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">New disposition</span><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as SubmittalPackageStatus })}><SelectTrigger aria-label="Revision disposition"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{packageStatuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent></Select></label>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Reviewer</span><Input value={form.reviewerName} onChange={(event) => setForm({ ...form, reviewerName: event.target.value })} placeholder="Architect / engineer / owner" /></label>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Review comments</span><Textarea rows={4} value={form.reviewComments} onChange={(event) => setForm({ ...form, reviewComments: event.target.value })} placeholder="Disposition notes and required corrections" /></label>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Recording…' : 'Record revision'}</Button></div>
  </form></Modal>;
}

function CoordinationForm({ packageId, revisions, onClose, onSaved }: { packageId: number; revisions: SubmittalPackage['revisions']; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    coordinationType: 'procurement' as SubmittalCoordinationType,
    status: 'pending' as SubmittalCoordinationStatus,
    revisionId: '',
    ownerName: '',
    externalReference: '',
    dueDate: '',
    notes: '',
    failureReason: '',
  });
  const create = useCreateSubmittalCoordination();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      submittalId: packageId,
      data: {
        coordinationType: form.coordinationType,
        status: form.status,
        revisionId: form.revisionId ? Number(form.revisionId) : undefined,
        ownerName: form.ownerName.trim() || undefined,
        externalReference: form.externalReference.trim() || undefined,
        dueDate: form.dueDate || undefined,
        notes: form.notes.trim() || undefined,
        failureReason: form.status === 'failed' ? form.failureReason.trim() || undefined : undefined,
      },
    }, { onSuccess: onSaved });
  };
  return <Modal title="Add coordination record" onClose={onClose}><form className="space-y-4" onSubmit={submit}>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Coordination area</span><Select value={form.coordinationType} onValueChange={(value) => setForm({ ...form, coordinationType: value as SubmittalCoordinationType })}><SelectTrigger aria-label="Coordination area"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{coordinationTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Status</span><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as SubmittalCoordinationStatus })}><SelectTrigger aria-label="Coordination status"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{coordinationStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></label>
    </div>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Linked revision</span><Select value={form.revisionId || 'none'} onValueChange={(value) => setForm({ ...form, revisionId: value === 'none' ? '' : value })}><SelectTrigger aria-label="Linked submittal revision"><SelectValue placeholder="No revision linked" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="none">No revision linked</SelectItem>{revisions.map((revision) => <SelectItem key={revision.id} value={String(revision.id)}>R{revision.revision} · {label(packageStatuses, revision.status)}</SelectItem>)}</SelectContent></Select></label>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner</span><Input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} placeholder="Purchasing or project manager" /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Due date</span><Input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
    </div>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">External reference</span><Input value={form.externalReference} onChange={(event) => setForm({ ...form, externalReference: event.target.value })} placeholder="PO, work package, schedule activity, or provider ID" /></label>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Notes</span><Textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="What downstream work must happen after this revision?" /></label>
    {form.status === 'failed' && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Failure reason</span><Textarea rows={2} value={form.failureReason} onChange={(event) => setForm({ ...form, failureReason: event.target.value })} placeholder="Explain what blocked the handoff" /></label>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add coordination'}</Button></div>
  </form></Modal>;
}

function CoordinationPanel({ packageId, revisions, canEdit, onChanged }: { packageId: number; revisions: SubmittalPackage['revisions']; canEdit: boolean; onChanged: () => void }) {
  const query = useListSubmittalCoordination(packageId, { query: { queryKey: getListSubmittalCoordinationQueryKey(packageId) } });
  const update = useUpdateSubmittalCoordination();
  const remove = useDeleteSubmittalCoordination();
  const [showForm, setShowForm] = useState(false);
  const records = query.data ?? [];
  const updateStatus = (record: SubmittalCoordination, status: SubmittalCoordinationStatus) => {
    update.mutate({ coordinationId: record.id, data: { status, failureReason: status === 'failed' ? record.failureReason : null } }, { onSuccess: onChanged });
  };
  return <section className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Link2 size={15} className="text-primary" /><h2 className="text-base font-bold">Downstream coordination</h2></div><p className="mt-1 text-xs text-muted-foreground">Track handoffs into procurement, fabrication, installation, and the project schedule.</p></div>{canEdit && <Button variant="outline" onClick={() => setShowForm(true)}><Plus size={15} /> Add</Button>}</div>
    {query.isLoading ? <LoadingPanel lines={3} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : records.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No downstream coordination has been recorded.</p> : <div className="mt-4 space-y-3">{records.map((record) => <div key={record.id} className="rounded-lg border border-border bg-secondary/20 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{label(coordinationTypes, record.coordinationType)}</span><Badge tone={record.status === 'completed' ? 'green' : record.status === 'failed' || record.status === 'blocked' ? 'red' : 'neutral'}>{label(coordinationStatuses, record.status)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{record.ownerName || 'No owner assigned'}{record.dueDate ? ` · Due ${shortDate(record.dueDate)}` : ''}{record.externalReference ? ` · ${record.externalReference}` : ''}</p></div>{canEdit && <Button variant="ghost" className="p-1 text-muted-foreground" aria-label={`Delete ${label(coordinationTypes, record.coordinationType)} coordination`} onClick={() => remove.mutate({ coordinationId: record.id }, { onSuccess: onChanged })}><Trash2 size={13} /></Button>}</div>{canEdit && <Select value={record.status} onValueChange={(value) => updateStatus(record, value as SubmittalCoordinationStatus)}><SelectTrigger aria-label={`Status for ${label(coordinationTypes, record.coordinationType)}`} className="mt-3 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{coordinationStatuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent></Select>}{record.notes && <p className="mt-2 text-xs leading-5 text-muted-foreground">{record.notes}</p>}{record.failureReason && <p className="mt-2 text-xs text-destructive">Failure: {record.failureReason}</p>}</div>)}</div>}
    {showForm && <CoordinationForm packageId={packageId} revisions={revisions} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); onChanged(); }} />}
  </section>;
}

function DocumentUpload({ itemId, onUploaded }: { itemId: number; onUploaded: () => void }) {
  const requestUpload = useRequestSubmittalDocumentUpload();
  const completeUpload = useCompleteSubmittalDocumentUpload();
  const [error, setError] = useState('');
  const [uploadingName, setUploadingName] = useState('');
  const upload = async (file: File) => {
    setError('');
    setUploadingName(file.name);
    try {
      const pending = await requestUpload.mutateAsync({
        itemId,
        data: {
          originalName: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
        },
      });
      const stored = await fetch(pending.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!stored.ok) throw new Error('The file could not be stored.');
      await completeUpload.mutateAsync({ documentId: pending.id });
      onUploaded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The file could not be uploaded.');
    } finally {
      setUploadingName('');
    }
  };
  return <div className="mt-3 rounded-lg border border-dashed border-border bg-secondary/25 p-3">
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-accent hover:underline">
      <Plus size={14} />
      {uploadingName ? `Uploading ${uploadingName}…` : 'Upload document'}
      <input
        type="file"
        className="sr-only"
        disabled={Boolean(uploadingName)}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
    </label>
    <p className="mt-1 text-[11px] text-muted-foreground">PDFs, images, office files, and other project documents up to 100 MB.</p>
    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
  </div>;
}

function DocumentLink({ document, canEdit, onChanged }: { document: SubmittalDocument; canEdit: boolean; onChanged: () => void }) {
  const remove = useDeleteSubmittalDocument();
  const statusLabel = document.status === 'rejected' ? 'rejected by safety screening' : 'pending';
  return <div className="flex items-center gap-2">
    {document.status === 'uploaded'
      ? <a className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline" href={document.downloadUrl} target="_blank" rel="noreferrer"><span className="truncate">V{document.version} · {document.originalName}</span><ExternalLink size={12} /></a>
      : <span className={document.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground'}>{document.originalName} · {statusLabel}</span>}
     <span className="mono text-[10px] text-muted-foreground">{Math.ceil(document.size / 1024)} KB{document.pageCount ? ` · ${document.pageCount} pages` : ''}</span>
    {canEdit && <Button variant="ghost" className="p-1 text-muted-foreground" aria-label={`Delete ${document.originalName}`} onClick={() => remove.mutate({ documentId: document.id }, { onSuccess: onChanged })}><Trash2 size={13} /></Button>}
  </div>;
}

type BuilderEntry = {
  itemId: number;
  documentId: number | null;
  pageOrder: string;
};

const pageOrderText = (document?: SubmittalDocument) =>
  document?.pageOrder?.join(', ') || (document?.pageCount ? Array.from({ length: document.pageCount }, (_, index) => index + 1).join(', ') : '');

function PackageBuilder({ pkg, onClose, onSaved }: { pkg: SubmittalPackage; onClose: () => void; onSaved: () => void }) {
  const initialEntries = pkg.items.map((item) => {
    const pdf = item.documents?.find((document) => document.status === 'uploaded' && document.contentType === 'application/pdf');
    return { itemId: item.id, documentId: pdf?.id ?? null, pageOrder: pageOrderText(pdf) };
  });
  const [order, setOrder] = useState<number[]>(() => pkg.items.map((item) => item.id));
  const [entries, setEntries] = useState<BuilderEntry[]>(initialEntries);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const itemById = new Map(pkg.items.map((item) => [item.id, item]));
  const entryByItemId = new Map(entries.map((entry) => [entry.itemId, entry]));
  const parsePageOrder = (entry: BuilderEntry, itemName: string) => {
    if (!entry.documentId) throw new Error(`${itemName} needs an uploaded PDF before it can be assembled.`);
    const pages = entry.pageOrder.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
    if (pages.length === 0 || new Set(pages).size !== pages.length) throw new Error(`${itemName} has an invalid page order.`);
    return pages;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const packageItems = order.map((itemId) => itemById.get(itemId)!);
      const assemblyItems = packageItems.filter((item) => entryByItemId.get(item.id)?.documentId).map((item) => {
        const entry = entryByItemId.get(item.id)!;
        return { itemId: item.id, documentId: entry.documentId!, pageOrder: parsePageOrder(entry, item.name) };
      });
      if (assemblyItems.length === 0) throw new Error('Add at least one uploaded PDF before building the package.');
      await reorderSubmittalItems(pkg.id, { itemIds: order });
      await Promise.all(assemblyItems.map((entry) => reorderSubmittalDocumentPages(entry.documentId, { pageOrder: entry.pageOrder })));
      await buildSubmittalPackageAssembly(pkg.id, { items: assemblyItems });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to build the package.');
    } finally {
      setBusy(false);
    }
  };
  const move = (itemId: number, direction: -1 | 1) => {
    setOrder((current) => {
      const index = current.indexOf(itemId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };
  return <Modal title="Build submittal package" onClose={onClose}>
    <form className="space-y-4" onSubmit={submit}>
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><p className="font-semibold">Assemble this package inside Construct Lifecycle</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Reorder the package items, set the page sequence for each PDF, and generate a protected versioned PDF. The source documents stay unchanged.</p></div>
      <div className="space-y-3">
        {order.map((itemId, index) => {
          const item = itemById.get(itemId)!;
          const entry = entryByItemId.get(itemId)!;
          const pdfs = item.documents?.filter((document) => document.status === 'uploaded' && document.contentType === 'application/pdf') ?? [];
          return <div key={item.id} className="rounded-lg border border-border bg-secondary/20 p-3">
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{index + 1}. {item.name}</p><p className="text-xs text-muted-foreground">{label(itemTypes, item.itemType)}</p></div><div className="flex gap-1"><Button type="button" variant="ghost" className="p-1" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => move(item.id, -1)}><ArrowUp size={14} /></Button><Button type="button" variant="ghost" className="p-1" aria-label={`Move ${item.name} down`} disabled={index === order.length - 1} onClick={() => move(item.id, 1)}><ArrowDown size={14} /></Button></div></div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Source PDF</span><Select value={entry.documentId ? String(entry.documentId) : 'none'} onValueChange={(value) => setEntries((current) => current.map((candidate) => candidate.itemId === item.id ? { ...candidate, documentId: value === 'none' ? null : Number(value), pageOrder: pageOrderText(pdfs.find((document) => document.id === Number(value))) } : candidate))}><SelectTrigger aria-label={`Source PDF for ${item.name}`}><SelectValue placeholder="Select PDF" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="none">Select a PDF</SelectItem>{pdfs.map((document) => <SelectItem key={document.id} value={String(document.id)}>V{document.version} · {document.originalName}</SelectItem>)}</SelectContent></Select></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Page order</span><Input value={entry.pageOrder} disabled={!entry.documentId} onChange={(event) => setEntries((current) => current.map((candidate) => candidate.itemId === item.id ? { ...candidate, pageOrder: event.target.value } : candidate))} placeholder="1, 2, 3" aria-label={`Page order for ${item.name}`} /></label>
            </div>
            {pdfs.length === 0 && <p className="mt-2 text-xs text-amber-700">Upload a PDF for this item to include it in the assembled package.</p>}
          </div>;
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !order.length}>{busy ? 'Building…' : 'Build PDF package'}</Button></div>
    </form>
  </Modal>;
}

function PackageDetail({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeRole } = useTenant();
  const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const query = useGetSubmittalPackage(id, { query: { queryKey: getGetSubmittalPackageQueryKey(id) } });
  const [showEdit, setShowEdit] = useState(false);
  const [showItem, setShowItem] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const removeItem = useDeleteSubmittalItem();
  const removePackage = useDeleteSubmittalPackage();
  const pkg = query.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: getGetSubmittalPackageQueryKey(id) }); qc.invalidateQueries({ queryKey: getListSubmittalPackagesQueryKey() }); };
  if (query.isLoading) return <LoadingPanel lines={8} />;
  if (query.isError || !pkg) return <ErrorPanel onRetry={() => query.refetch()} />;
  return <div className="animate-rise">
     <PageTitle eyebrow={`Submittals / ${pkg.packageNumber}`} title={pkg.name} description={`${pkg.projectNumber} · ${pkg.projectName} · ${pkg.customerName}`} action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate('/submittals')}>Back to packages</Button>{canEdit && <><Button variant="outline" onClick={() => setShowBuilder(true)}><Layers3 size={15} /> Build package</Button><Button onClick={() => setShowEdit(true)}><Pencil size={15} /> Edit package</Button></>}</div>} />
    <div className="mb-5 grid gap-3 md:grid-cols-4">
      <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Disposition</p><div className="mt-2"><Badge tone={tone(pkg.status)}>{label(packageStatuses, pkg.status)}</Badge></div></div>
      <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Revision</p><p className="mono mt-2 text-2xl font-semibold">R{pkg.revision}</p></div>
      <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Items</p><p className="mono mt-2 text-2xl font-semibold">{pkg.itemCount}</p></div>
      <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Required by</p><p className="mt-2 text-sm font-semibold">{shortDate(pkg.dueDate)}</p></div>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.45fr_.8fr]">
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold">Package contents</h2><p className="text-xs text-muted-foreground">Coordinate the technical items before release or installation.</p></div>{canEdit && <Button onClick={() => setShowItem(true)}><Plus size={15} /> Add item</Button>}</div>
        {pkg.items.length === 0 ? <div className="p-5"><EmptyState icon={FileText} title="No items in this package" text="Add shop drawings, product data, samples, or other required documentation." action={canEdit ? <Button onClick={() => setShowItem(true)}><Plus size={15} /> Add first item</Button> : undefined} /></div> : <div className="divide-y divide-border">{pkg.items.map((item) => <div key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="mono text-[10px] text-accent">{item.itemNumber}</span><Badge tone={tone(item.status)}>{label(itemStatuses, item.status)}</Badge></div><p className="mt-1 text-sm font-bold">{item.name}</p><p className="text-xs text-muted-foreground">{label(itemTypes, item.itemType)}{item.description ? ` · ${item.description}` : ''}</p>{item.documentName && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">{item.documentUrl ? <a className="inline-flex items-center gap-1 text-accent hover:underline" href={item.documentUrl} target="_blank" rel="noreferrer">{item.documentName} <ExternalLink size={12} /></a> : item.documentName}</p>}{item.documents && item.documents.length > 0 && <div className="mt-3 space-y-1 text-xs">{item.documents.map((document) => <DocumentLink key={document.id} document={document} canEdit={canEdit} onChanged={refresh} />)}</div>}{canEdit && <DocumentUpload itemId={item.id} onUploaded={refresh} />}</div>{canEdit && <Button variant="ghost" className="self-end p-2 sm:self-start" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete ${item.name}?`)) removeItem.mutate({ itemId: item.id }, { onSuccess: refresh }); }}><Trash2 size={15} /></Button>}</div>)}</div>}
      </section>
      <div className="space-y-5">
        <CoordinationPanel packageId={pkg.id} revisions={pkg.revisions} canEdit={canEdit} onChanged={refresh} />
        <section className="rounded-xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-bold">Review history</h2><p className="mt-1 text-xs text-muted-foreground">Every disposition creates an immutable revision record.</p></div>{canEdit && <Button variant="outline" onClick={() => setShowRevision(true)}><Plus size={15} /> Revision</Button>}</div><div className="mt-4 space-y-4">{pkg.revisions.length === 0 ? <p className="text-sm text-muted-foreground">No formal review recorded yet.</p> : pkg.revisions.map((revision) => <div key={revision.id} className="border-l-2 border-primary/25 pl-3"><div className="flex flex-wrap items-center gap-2"><span className="mono text-[10px] text-muted-foreground">R{revision.revision}</span><Badge tone={tone(revision.status)}>{label(packageStatuses, revision.status)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{revision.reviewerName || 'Team review'} · {shortDate(revision.createdAt)}</p>{revision.reviewComments && <p className="mt-2 text-sm">{revision.reviewComments}</p>}</div>)}</div></section>
         <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-base font-bold">Package context</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Origin</dt><dd className="text-right font-semibold">{label(originTypes, pkg.originType)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Specification</dt><dd className="text-right font-semibold">{pkg.specificationSection || 'Not assigned'}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Responsible party</dt><dd className="text-right font-semibold">{pkg.responsibleParty || 'Not assigned'}</dd></div>{pkg.sourceBidNumber && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Source bid</dt><dd className="text-right font-semibold">{pkg.sourceBidNumber}</dd></div>}</dl>{pkg.description && <p className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">{pkg.description}</p>}{pkg.assemblies.length > 0 && <div className="mt-5 border-t border-border pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Built versions</p><div className="mt-3 space-y-2">{pkg.assemblies.map((assembly) => <a key={assembly.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs hover:bg-secondary/40" href={assembly.downloadUrl} target="_blank" rel="noreferrer"><span><span className="font-semibold">Version {assembly.version}</span><span className="ml-2 text-muted-foreground">{Math.ceil(assembly.size / 1024)} KB · {shortDate(assembly.createdAt)}</span></span><Download size={14} className="text-accent" /></a>)}</div></div>}</section>
        {activeRole === 'owner' || activeRole === 'admin' ? <Button variant="danger" className="w-full justify-center" onClick={() => { if (window.confirm(`Delete ${pkg.name}?`)) removePackage.mutate({ submittalId: pkg.id }, { onSuccess: () => navigate('/submittals') }); }}>Delete package</Button> : null}
      </div>
    </div>
    {showEdit && <PackageForm item={pkg} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); refresh(); }} />}
    {showItem && <ItemForm packageId={pkg.id} onClose={() => setShowItem(false)} onSaved={() => { setShowItem(false); refresh(); }} />}
    {showRevision && <RevisionForm packageId={pkg.id} onClose={() => setShowRevision(false)} onSaved={() => { setShowRevision(false); refresh(); }} />}
     {showBuilder && <PackageBuilder pkg={pkg} onClose={() => setShowBuilder(false)} onSaved={() => { setShowBuilder(false); refresh(); }} />}
  </div>;
}

function PackageList() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeRole } = useTenant();
  const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SubmittalPackageStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const queryParams = useMemo(() => ({ search: search.trim() || undefined, status: status || undefined }), [search, status]);
  const query = useListSubmittalPackages(queryParams, { query: { queryKey: getListSubmittalPackagesQueryKey(queryParams) } });
  const remove = useDeleteSubmittalPackage();
  const packages = query.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: getListSubmittalPackagesQueryKey() });
  return <div className="animate-rise">
    <PageTitle eyebrow="Project delivery" title="Submittals" description="Track formal post-award packages separately from bid-stage proposal attachments." action={canEdit ? <Button onClick={() => setShowForm(true)}><Plus size={15} /> New package</Button> : undefined} />
    <div className="mb-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible packages</p><p className="mt-2 text-2xl font-semibold">{packages.length}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Needs review</p><p className="mt-2 text-2xl font-semibold">{packages.filter((item) => item.status === 'under_review' || item.status === 'revise_and_resubmit').length}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Approved</p><p className="mt-2 text-2xl font-semibold">{packages.filter((item) => item.status === 'approved' || item.status === 'approved_as_noted').length}</p></div></div>
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Search submittals" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search package, project, customer, or number" className="h-10 border-transparent bg-secondary/65 pl-9" /></label><Select value={status || 'all'} onValueChange={(value) => setStatus(value === 'all' ? '' : value as SubmittalPackageStatus)}><SelectTrigger aria-label="Filter submittals by status" className="h-10 border-transparent bg-secondary/65 md:w-56"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All statuses</SelectItem>{packageStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>{(search || status) && <Button variant="ghost" onClick={() => { setSearch(''); setStatus(''); }}>Clear</Button>}</div>
    {query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : packages.length === 0 ? <EmptyState icon={ClipboardCheck} title="No submittal packages match this view" text={search || status ? 'Try a different search or clear the filter.' : 'Create the first post-award package for a project.'} action={canEdit ? <Button onClick={() => setShowForm(true)}><Plus size={15} /> Add package</Button> : undefined} /> : <div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[1.4fr_1.2fr_145px_90px_120px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">{['Package', 'Project', 'Status', 'Items', 'Due', ''].map((item) => <span key={item} className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">{item}</span>)}</div><div className="divide-y divide-border">{packages.map((item) => <div key={item.id} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.4fr_1.2fr_145px_90px_120px_44px] md:items-center md:gap-4"><Link href={`/submittals/${item.id}`} className="min-w-0"><p className="mono text-[10px] text-accent">{item.packageNumber}</p><p className="truncate text-sm font-bold">{item.name}</p><p className="truncate text-xs text-muted-foreground">{item.customerName}</p></Link><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.projectNumber}</p><p className="truncate text-xs text-muted-foreground">{item.projectName}</p></div><Badge tone={tone(item.status)}>{label(packageStatuses, item.status)}</Badge><p className="mono text-sm">{item.itemCount}</p><p className="text-xs text-muted-foreground">{shortDate(item.dueDate)}</p><div className="flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100">{canEdit && <Button variant="ghost" className="p-2" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete ${item.name}?`)) remove.mutate({ submittalId: item.id }, { onSuccess: refresh }); }}><Trash2 size={15} /></Button>}</div></div>)}</div></div>}
    {showForm && <PackageForm onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); navigate(`/submittals/${id}`); }} />}
  </div>;
}

export function Submittals() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : null;
  return id && Number.isFinite(id) ? <PackageDetail id={id} /> : <PackageList />;
}

export default Submittals;