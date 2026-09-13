import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive, Check, CheckCircle2, ChevronRight, ExternalLink, FileText, Inbox,
  Mail, Paperclip, Plus, RefreshCw, Search, ShieldCheck, Upload, XCircle,
  RotateCcw,
} from 'lucide-react';
import {
  ItbIntake, ItbIntakeApprovalInput, ItbIntakeInput, ItbIntakeStatus,
  useApproveItbIntake, useCreateItbIntake, useGetItbIntake, useImportItbMailboxMessage, useMergeItbIntake,
  useListBusinessCustomers, useListItbDocuments, useListItbIntakes, usePreviewItbMailbox,
  useApplyItbDocumentFindings, useProcessItbDocument, useRetryItbDocument, useReviewItbDocumentFindings,
  useRequestItbAttachmentUpload, useUpdateItbIntake,
  getGetItbIntakeQueryKey, getListBusinessCustomersQueryKey, getListItbDocumentsQueryKey, getListItbIntakesQueryKey,
  getPreviewItbMailboxQueryKey,
} from '@workspace/api-client-react';
import { Button, Badge, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';

const tone = (status: string) => status === 'approved' ? 'green' as const : status === 'rejected' || status === 'failed' ? 'red' as const : status === 'archived' ? 'neutral' as const : 'orange' as const;
const label = (status: string) => status.replace('_', ' ');

function Field({ name, value, confidence, evidence, onChange }: { name: string; value: string; confidence: number; evidence: string; onChange: (value: string) => void }) {
  return <div className="rounded-lg border border-border bg-background p-3">
    <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold capitalize">{name.replace(/([A-Z])/g, ' $1')}</span><span className="mono text-[10px] text-muted-foreground">{Math.round(confidence * 100)}% confidence</span></div>
    <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    <p className="mt-2 border-l-2 border-accent/40 pl-2 text-[11px] leading-4 text-muted-foreground">Evidence: {evidence || 'No source evidence recorded.'}</p>
  </div>;
}

function ManualIntake({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const create = useCreateItbIntake();
  const upload = useRequestItbAttachmentUpload();
  const [form, setForm] = useState({ subject: '', sender: '', senderEmail: '', body: '' });
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      let attachments: ItbIntakeInput['attachments'];
      if (file) {
        const uploadInfo = await upload.mutateAsync({ data: { originalName: file.name, contentType: file.type || 'application/octet-stream', size: file.size } });
        const result = await fetch(uploadInfo.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        if (!result.ok) throw new Error('Attachment upload failed');
        attachments = [{ originalName: file.name, contentType: file.type || 'application/octet-stream', size: file.size, objectPath: uploadInfo.objectPath }];
      }
      const intake = await create.mutateAsync({ data: { sourceType: 'manual', sourceSender: form.sender, sourceSenderEmail: form.senderEmail || undefined, sourceSubject: form.subject, sourceBody: form.body, attachments } });
      onCreated(intake.id);
    } catch { setError('The intake could not be created. Check the source details and try again.'); }
  };
  return <Modal title="Add intake manually" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold">Subject</span><Input required value={form.subject} onChange={(e) => set('subject', e.target.value)} /></label><label><span className="mb-1.5 block text-xs font-semibold">Sender</span><Input required value={form.sender} onChange={(e) => set('sender', e.target.value)} placeholder="Company or person" /></label><label><span className="mb-1.5 block text-xs font-semibold">Sender email</span><Input type="email" value={form.senderEmail} onChange={(e) => set('senderEmail', e.target.value)} /></label></div>
    <label><span className="mb-1.5 block text-xs font-semibold">Source body</span><Textarea required rows={8} value={form.body} onChange={(e) => set('body', e.target.value)} placeholder="Paste the invitation-to-bid email or source text." /></label>
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-secondary/35 p-4"><Upload size={16} className="text-accent" /><span className="min-w-0 flex-1 text-xs">{file ? file.name : 'Attach plans, specifications, or bid documents'}</span><input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0])} /><span className="text-xs font-semibold text-accent">Choose file</span></label>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={create.isPending || upload.isPending}>{create.isPending || upload.isPending ? 'Creating…' : 'Create intake'}</Button></div>
  </form></Modal>;
}

function Mailbox({ onImported }: { onImported: (id: number) => void }) {
  const [q, setQ] = useState('newer_than:30d (bid OR tender OR invitation)');
  const [run, setRun] = useState(false);
  const preview = usePreviewItbMailbox({ q, pageSize: 20 }, { query: { queryKey: getPreviewItbMailboxQueryKey({ q, pageSize: 20 }), enabled: run } });
  const importMessage = useImportItbMailboxMessage();
  return <Modal title="Preview connected Gmail mailbox" onClose={() => onImported(0)}><div className="space-y-4">
    <div className="rounded-lg border border-accent/20 bg-accent/5 p-3"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-accent" /> Bounded mailbox query</div><p className="mt-1 text-[11px] text-muted-foreground">Only matching messages are shown. Nothing is imported until you choose a message.</p><div className="mt-3 flex gap-2"><Input value={q} maxLength={180} onChange={(e) => setQ(e.target.value)} /><Button onClick={() => setRun(true)} disabled={!q.trim() || preview.isFetching}><Search size={15} /> Preview</Button></div></div>
    {preview.isLoading ? <LoadingPanel lines={4} /> : preview.isError ? <ErrorPanel onRetry={() => preview.refetch()} /> : run && (preview.data ?? []).length === 0 ? <EmptyState icon={Mail} title="No messages found" text="Try a narrower or more recent Gmail query." /> : <div className="divide-y divide-border rounded-lg border border-border">{(preview.data ?? []).map((message) => <div key={message.messageId} className="flex items-start gap-3 p-3"><Mail size={16} className="mt-1 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{message.subject || '(No subject)'}</p><p className="text-xs text-muted-foreground">{message.sender} · {new Date(message.receivedAt).toLocaleDateString()}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.snippet}</p></div><Button variant="outline" disabled={message.imported || importMessage.isPending} onClick={() => importMessage.mutate({ data: { threadId: message.threadId, messageId: message.messageId } }, { onSuccess: (intake) => onImported(intake.id) })}>{message.imported ? 'Imported' : 'Import'}</Button></div>)}</div>}
  </div></Modal>;
}

function DocumentReview({ intakeId, attachments }: { intakeId: number; attachments: ItbIntake['attachments'] }) {
  const qc = useQueryClient();
  const documents = useListItbDocuments(intakeId, { query: { queryKey: getListItbDocumentsQueryKey(intakeId) } });
  const process = useProcessItbDocument();
  const retry = useRetryItbDocument();
  const review = useReviewItbDocumentFindings();
  const apply = useApplyItbDocumentFindings();
  const refresh = () => qc.invalidateQueries({ queryKey: getListItbDocumentsQueryKey(intakeId) });
  return <section className="rounded-xl border border-border bg-card p-4">
    <div className="mb-4 flex items-start justify-between gap-3"><div><p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Document parsing</p><p className="mt-1 text-xs text-muted-foreground">Protected files are parsed into evidence for review. Nothing is routed automatically.</p></div><Badge tone="neutral">Human review</Badge></div>
    {documents.isLoading ? <LoadingPanel lines={4} /> : documents.isError ? <ErrorPanel onRetry={() => documents.refetch()} /> : attachments.length === 0 ? <p className="text-xs text-muted-foreground">No protected documents are attached to this intake.</p> : <div className="space-y-3">{attachments.map((attachment) => {
      const document = documents.data?.find((item) => item.attachmentId === attachment.id);
      return <div key={attachment.id} className="rounded-lg border border-border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2"><Paperclip size={14} className="text-accent" /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{attachment.originalName}</span>{document && <Badge tone={document.status === 'completed' ? 'green' : document.status === 'failed' ? 'red' : 'orange'}>{document.status.replace('_', ' ')}</Badge>}{!document && <Button variant="outline" className="h-8" onClick={() => process.mutate({ intakeId, data: { attachmentId: attachment.id } }, { onSuccess: refresh })} disabled={process.isPending}><FileText size={13} /> {process.isPending ? 'Parsing…' : 'Parse document'}</Button>}{document && ['failed', 'needs_review'].includes(document.status) && document.attemptCount < 3 && <Button variant="ghost" className="h-8" onClick={() => retry.mutate({ intakeId, documentId: document.id }, { onSuccess: refresh })} disabled={retry.isPending}><RotateCcw size={13} /> Retry</Button>}</div>
        {document?.errorMessage && <p className="mt-2 text-xs text-status-warning">{document.errorMessage}</p>}
        {document?.findings && document.findings.length > 0 && <div className="mt-3 space-y-2">{document.findings.map((finding) => <DocumentFinding key={finding.key} intakeId={intakeId} documentId={document.id} finding={finding} onSaved={refresh} />)}{document.findings.some((finding) => finding.status === 'accepted' || finding.status === 'corrected') && <Button variant="outline" className="mt-2 h-8 w-full" onClick={() => apply.mutate({ intakeId, documentId: document.id })} disabled={apply.isPending}><CheckCircle2 size={13} /> {apply.isPending ? 'Applying to intake…' : 'Apply accepted findings to intake'}</Button>}</div>}
        {document?.status === 'completed' && document.findings.length === 0 && <p className="mt-3 text-xs text-muted-foreground">Text was extracted, but no structured findings were detected.</p>}
      </div>;
    })}</div>}
  </section>;
}

function DocumentFinding({ intakeId, documentId, finding, onSaved }: { intakeId: number; documentId: number; finding: { key: string; label: string; value: string; confidence: number; evidence: string; page?: number | null; status: string; correctedValue?: string | null }; onSaved: () => void }) {
  const review = useReviewItbDocumentFindings();
  const [value, setValue] = useState(finding.correctedValue ?? finding.value);
  const save = (status: 'accepted' | 'rejected' | 'corrected') => review.mutate({ intakeId, documentId, data: { key: finding.key, status, correctedValue: status === 'corrected' ? value : undefined } }, { onSuccess: onSaved });
  return <div className="rounded-md border border-border bg-card p-3">
    <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold">{finding.label}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{Math.round(finding.confidence * 100)}% confidence{finding.page ? ` · page ${finding.page}` : ''}</p></div><Badge tone={finding.status === 'accepted' || finding.status === 'corrected' ? 'green' : finding.status === 'rejected' ? 'red' : 'orange'}>{finding.status}</Badge></div>
    <Input className="mt-2 h-8 text-xs" value={value} onChange={(event) => setValue(event.target.value)} aria-label={`Correct ${finding.label}`} />
    <p className="mt-2 border-l-2 border-accent/40 pl-2 text-[11px] leading-4 text-muted-foreground">Evidence: {finding.evidence}</p>
    <div className="mt-2 flex flex-wrap justify-end gap-2"><Button variant="ghost" className="h-7 text-[11px]" onClick={() => save('rejected')} disabled={review.isPending}>Reject</Button><Button variant="ghost" className="h-7 text-[11px]" onClick={() => save('accepted')} disabled={review.isPending}><Check size={12} /> Accept</Button><Button variant="outline" className="h-7 text-[11px]" onClick={() => save('corrected')} disabled={review.isPending}>Save correction</Button></div>
  </div>;
}

function IntakeDetail({ id, onChanged, candidates }: { id: number; onChanged: () => void; candidates: ItbIntake[] }) {
  const qc = useQueryClient(); const query = useGetItbIntake(id, { query: { queryKey: getGetItbIntakeQueryKey(id) } });
  const update = useUpdateItbIntake(); const approve = useApproveItbIntake(); const merge = useMergeItbIntake();
  const [mergeTarget, setMergeTarget] = useState('');
  const customers = useListBusinessCustomers(undefined, { query: { queryKey: getListBusinessCustomersQueryKey() } });
  const [customer, setCustomer] = useState(''); const [createOpportunity, setCreateOpportunity] = useState(true); const [createBid, setCreateBid] = useState(true); const [bidName, setBidName] = useState('');
  if (query.isLoading) return <LoadingPanel lines={8} />; if (query.isError || !query.data) return <ErrorPanel onRetry={() => query.refetch()} />;
  const intake = query.data; const extraction = intake.extraction; const sourceBody = (intake as ItbIntake & { sourceBody?: string }).sourceBody;
  const patchField = (key: keyof typeof extraction, value: string) => { const current = extraction[key]; if (Array.isArray(current)) return; update.mutate({ intakeId: id, data: { extraction: { ...extraction, [key]: { ...current, value } } } }, { onSuccess: (saved) => qc.setQueryData(getGetItbIntakeQueryKey(id), saved) }); };
  const decision = (status: ItbIntakeStatus) => { update.mutate({ intakeId: id, data: { status } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListItbIntakesQueryKey() }); query.refetch(); onChanged(); } }); };
  const approveIntake = () => { const data: ItbIntakeApprovalInput = { businessCustomerId: Number(customer), createOpportunity, createBid, ...(createBid && bidName ? { bidName } : {}) }; approve.mutate({ intakeId: id, data }, { onSuccess: (saved) => { qc.setQueryData(getGetItbIntakeQueryKey(id), saved); qc.invalidateQueries({ queryKey: getListItbIntakesQueryKey() }); onChanged(); } }); };
  const mergeIntake = () => { if (!mergeTarget) return; merge.mutate({ intakeId: id, data: { targetIntakeId: Number(mergeTarget) } }, { onSuccess: (saved) => { setMergeTarget(''); qc.setQueryData(getGetItbIntakeQueryKey(saved.id), saved); onChanged(); } }); };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mono text-[10px] uppercase tracking-[.14em] text-accent">{intake.sourceType} source · {intake.extractionStatus} extraction</p><h2 className="mt-1 text-xl font-bold">{intake.sourceSubject || extraction.projectName.value || 'Untitled intake'}</h2><p className="mt-1 text-xs text-muted-foreground">{intake.sourceSender || 'Unknown sender'} · received {intake.sourceReceivedAt ? new Date(intake.sourceReceivedAt).toLocaleDateString() : 'manually'}</p></div><Badge tone={tone(intake.status)}>{label(intake.status)}</Badge></div>
    {intake.warnings.length > 0 && <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning">{intake.warnings.join(' ')}</div>}
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><section className="rounded-xl border border-border bg-card p-4"><div className="mb-4 flex items-center justify-between"><p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Extracted fields</p><span className="text-xs text-muted-foreground">Review before approval</span></div><div className="grid gap-3 sm:grid-cols-2">{(['projectName', 'issuer', 'contactName', 'contactEmail', 'contactPhone', 'location', 'dueDate', 'estimatedValue'] as const).map((key) => <Field key={key} name={key} value={extraction[key].value || ''} confidence={extraction[key].confidence} evidence={extraction[key].evidence} onChange={(value) => patchField(key, value)} />)}</div></section>
      <aside className="space-y-4"><section className="rounded-xl border border-border bg-card p-4"><p className="mono mb-3 text-[10px] uppercase tracking-[.14em] text-muted-foreground">Source evidence</p><div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/45 p-3 text-xs leading-5">{sourceBody || 'Source body is available to the extraction service but was not returned by this API response.'}</div></section><section className="rounded-xl border border-border bg-card p-4"><p className="mono mb-3 text-[10px] uppercase tracking-[.14em] text-muted-foreground">Protected attachments</p>{intake.attachments.length === 0 ? <p className="text-xs text-muted-foreground">No attachments on this intake.</p> : intake.attachments.map((attachment) => <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2 py-2 text-xs font-semibold hover:bg-secondary"><Paperclip size={14} className="text-accent" /> <span className="min-w-0 flex-1 truncate">{attachment.originalName}</span><ExternalLink size={13} /></a>)}</section></aside></div>
    <DocumentReview intakeId={id} attachments={intake.attachments} />
    {intake.status === 'review' && <section className="rounded-xl border border-accent/25 bg-accent/5 p-4"><p className="mono mb-3 text-[10px] uppercase tracking-[.14em] text-accent">Human approval gate</p><div className="grid gap-3 md:grid-cols-2"><label><span className="mb-1.5 block text-xs font-semibold">Business customer</span><Select value={customer} onValueChange={setCustomer}><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger><SelectContent className="bg-popover">{(customers.data ?? []).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.companyName}</SelectItem>)}</SelectContent></Select></label><label className="flex items-center gap-2 self-end pb-2 text-xs"><input type="checkbox" checked={createOpportunity} onChange={(e) => setCreateOpportunity(e.target.checked)} /> Create opportunity</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={createBid} onChange={(e) => setCreateBid(e.target.checked)} /> Create bid</label>{createBid && <label><span className="mb-1.5 block text-xs font-semibold">Optional bid name</span><Input value={bidName} onChange={(e) => setBidName(e.target.value)} placeholder={extraction.projectName.value || 'Bid name'} /></label>}</div><div className="mt-4 flex flex-wrap items-end justify-end gap-2 border-t border-accent/15 pt-4"><label className="mr-auto min-w-[210px]"><span className="mb-1.5 block text-xs font-semibold">Merge duplicate into</span><Select value={mergeTarget || 'none'} onValueChange={(value) => setMergeTarget(value === 'none' ? '' : value)}><SelectTrigger><SelectValue placeholder="Choose surviving intake" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="none">No merge</SelectItem>{candidates.filter((candidate) => candidate.id !== id && ['review', 'failed'].includes(candidate.status)).map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.sourceSubject || `Intake #${candidate.id}`}</SelectItem>)}</SelectContent></Select></label>{mergeTarget && <Button variant="outline" onClick={mergeIntake} disabled={merge.isPending}><Archive size={15} /> {merge.isPending ? 'Merging…' : 'Merge duplicate'}</Button>}<Button variant="danger" onClick={() => decision('rejected')} disabled={update.isPending}><XCircle size={15} /> Reject</Button><Button variant="outline" onClick={() => decision('archived')} disabled={update.isPending}><Archive size={15} /> Archive</Button><Button onClick={approveIntake} disabled={!customer || approve.isPending}><CheckCircle2 size={15} /> {approve.isPending ? 'Approving…' : 'Approve intake'}</Button></div></section>}
  </div>;
}

export function ItbIntakes() {
  const qc = useQueryClient(); const [selected, setSelected] = useState<number>(); const [manual, setManual] = useState(false); const [mailbox, setMailbox] = useState(false); const [status, setStatus] = useState('');
  const params = useMemo(() => status ? { status: status as ItbIntakeStatus } : undefined, [status]); const query = useListItbIntakes(params, { query: { queryKey: getListItbIntakesQueryKey(params) } }); const intakes = query.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: getListItbIntakesQueryKey(params) });
  return <div className="animate-rise space-y-5"><PageTitle eyebrow="Pre-construction intake desk" title="ITB intakes" description="Turn invitation-to-bid messages into reviewable opportunities. Evidence stays visible until a human approves the handoff." action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setMailbox(true)}><Mail size={15} /> Gmail preview</Button><Button onClick={() => setManual(true)}><Plus size={15} /> Add intake</Button></div>} />
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Inbox size={15} className="text-accent" /><strong className="text-foreground">{intakes.length}</strong> visible intakes</div><Select value={status || 'all'} onValueChange={(value) => setStatus(value === 'all' ? '' : value)}><SelectTrigger className="h-9 sm:ml-auto sm:w-44"><SelectValue /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All statuses</SelectItem>{Object.values(ItbIntakeStatus).map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent></Select><Button variant="ghost" className="h-9" onClick={refresh}><RefreshCw size={14} /> Refresh</Button></div>
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,390px)_1fr]">{query.isLoading ? <LoadingPanel lines={6} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="border-b border-border bg-secondary/45 px-4 py-3"><span className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Review queue</span></div>{intakes.length === 0 ? <EmptyState icon={Inbox} title="Queue is clear" text="Add an intake manually or preview the connected Gmail mailbox." /> : <div className="divide-y divide-border">{intakes.map((item) => <button key={item.id} onClick={() => setSelected(item.id)} className={`flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-secondary/45 ${selected === item.id ? 'bg-accent/5' : ''}`}><div className="mt-0.5 rounded-md bg-secondary p-2"><FileText size={16} className="text-accent" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{item.sourceSubject || item.extraction.projectName.value || 'Untitled intake'}</p><ChevronRight size={15} className="shrink-0 text-muted-foreground" /></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.sourceSender || 'Unknown sender'}</p><div className="mt-2 flex items-center gap-2"><Badge tone={tone(item.status)}>{label(item.status)}</Badge><span className="mono text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span></div></div></button>)}</div>}</section>}<section className="min-w-0 rounded-xl border border-border bg-card p-5">{selected ? <IntakeDetail id={selected} onChanged={refresh} candidates={intakes} /> : <div className="flex min-h-96 flex-col items-center justify-center text-center"><Inbox size={26} className="mb-3 text-muted-foreground" /><h2 className="text-sm font-bold">Select an intake to review</h2><p className="mt-1 max-w-sm text-xs text-muted-foreground">The source message, extracted fields, confidence, and protected documents will appear here.</p></div>}</section></div>
    {manual && <ManualIntake onClose={() => setManual(false)} onCreated={(id) => { setManual(false); refresh(); setSelected(id); }} />}{mailbox && <Mailbox onImported={(id) => { setMailbox(false); if (id) { refresh(); setSelected(id); } }} />}
  </div>;
}

export default ItbIntakes;