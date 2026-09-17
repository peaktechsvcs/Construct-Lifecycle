import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { AlertTriangle, ArrowLeft, Archive, Building2, CheckCircle2, FileText, Mail, MapPin, Pencil, Phone, Plus, ShieldCheck } from 'lucide-react';
import {
  BusinessCustomer,
  BusinessCustomerInput,
  getGetBusinessCustomerQueryKey,
  getGetBusinessCustomerSupplierAccountHistoryQueryKey,
  useGetBusinessCustomerSupplierAccountHistory,
  useGetBusinessCustomer,
  useUpdateBusinessCustomer,
} from '@workspace/api-client-react';
import type { SupplierAccountInvoice } from '@workspace/api-client-react';
import { Badge, Button, currency, ErrorPanel, LoadingPanel, Modal, PageTitle, shortDate } from '@/components/app-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/providers/tenant-provider';
import { useWorkflow } from '@/hooks/use-workflow';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { customerTypeOptions } from '@/lib/customer-type-options';
import { Button as DesignButton } from '@workspace/construct-lifecycle-design-system/components/ui/button';

const inputClass = 'h-10 bg-background';

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const [showEdit, setShowEdit] = useState(false);
  const query = useGetBusinessCustomer(customerId, { query: { queryKey: getGetBusinessCustomerQueryKey(customerId), enabled: Number.isFinite(customerId) } });
  const accountHistory = useGetBusinessCustomerSupplierAccountHistory(customerId, { query: { queryKey: getGetBusinessCustomerSupplierAccountHistoryQueryKey(customerId), enabled: Number.isFinite(customerId) } });
  const update = useUpdateBusinessCustomer();
  const qc = useQueryClient();
  const { activeRole } = useTenant();
  const canManage = activeRole === 'owner' || activeRole === 'admin';
  const canCreateProject = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const customer = query.data;
  const workflow = useWorkflow();

  if (query.isLoading) return <LoadingPanel lines={7} />;
  if (query.isError || !customer) return <ErrorPanel onRetry={() => query.refetch()} />;

  const save = (data: BusinessCustomerInput) => update.mutate(
    { customerId, data },
    { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetBusinessCustomerQueryKey(customerId) }); qc.invalidateQueries({ queryKey: ['/api/customers'] }); setShowEdit(false); } },
  );

  return (
    <div className="animate-rise">
      <Link href="/customers" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Back to customers</Link>
      <PageTitle
        eyebrow="Business customer"
        title={customer.companyName}
        description={`${customer.projectCount} connected project${customer.projectCount === 1 ? '' : 's'} in this environment.`}
         action={canManage ? <div className="flex gap-2"><Button variant="outline" onClick={() => setShowEdit(true)}><Pencil size={15} /> Edit</Button>{canCreateProject && <DesignButton asChild><Link href={`/projects?customerId=${customer.id}`}><Plus size={15} /> New project</Link></DesignButton>}</div> : canCreateProject ? <DesignButton asChild><Link href={`/projects?customerId=${customer.id}`}><Plus size={15} /> New project</Link></DesignButton> : undefined}
      />
      <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><Building2 size={17} /></span><h2 className="text-base font-bold">Relationship record</h2></div><Badge tone={customer.status === 'active' ? 'green' : 'neutral'}>{customer.status}</Badge></div>
          <div className="space-y-1">
            <div className="flex items-center gap-3 border-b border-border/70 py-3 text-sm"><span className="w-5 text-muted-foreground"><Building2 size={15} /></span><span>{customer.customerType}</span></div>
            <div className="flex items-center gap-3 border-b border-border/70 py-3 text-sm"><span className="w-5 text-muted-foreground"><Pencil size={15} /></span><span>{customer.primaryContact || 'No primary contact'}</span></div>
            <div className="flex items-center gap-3 border-b border-border/70 py-3 text-sm"><span className="w-5 text-muted-foreground"><Mail size={15} /></span><span>{customer.email || 'No email'}</span></div>
            <div className="flex items-center gap-3 border-b border-border/70 py-3 text-sm"><span className="w-5 text-muted-foreground"><Phone size={15} /></span><span>{customer.phone || 'No phone'}</span></div>
          </div>
          {canManage && <Button variant="ghost" className="mt-5 px-2 text-xs text-muted-foreground" disabled={update.isPending} onClick={() => update.mutate({ customerId, data: { status: customer.status === 'active' ? 'archived' : 'active' } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetBusinessCustomerQueryKey(customerId) }); qc.invalidateQueries({ queryKey: ['/api/customers'] }); } })}><Archive size={14} /> {customer.status === 'active' ? 'Archive customer' : 'Restore customer'}</Button>}
        </section>
        <section className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Connected work</p><h2 className="mt-1 text-base font-bold">Projects</h2></div><span className="mono text-xs text-muted-foreground">{customer.projects.length} total</span></div>
          {customer.projects.length ? <div className="divide-y divide-border">{customer.projects.map((project) => <Link key={project.id} href={`/projects/${project.id}`} className="flex items-center gap-4 py-4 hover:text-primary"><div className="min-w-0 flex-1"><p className="mono text-[10px] text-accent">{project.projectNumber}</p><p className="truncate text-sm font-bold">{project.projectName}</p><p className="mt-1 text-xs text-muted-foreground">{workflow.labels[project.stage] ?? project.stage.replace('_', ' ')} · Updated {shortDate(project.updatedAt)}</p></div><span className="mono text-sm">{currency.format(project.contractValue)}</span></Link>)}</div> : <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center"><MapPin className="mx-auto mb-3 text-muted-foreground" size={20} /><p className="text-sm font-semibold">No projects yet</p><p className="mt-1 text-xs text-muted-foreground">Create the first project from this relationship record.</p></div>}
        </section>
      </div>
      <SupplierAccountHistoryPanel history={accountHistory.data} loading={accountHistory.isLoading} error={accountHistory.isError} onRetry={() => accountHistory.refetch()} />
      {showEdit && <CustomerEditModal customer={customer} onClose={() => setShowEdit(false)} onSave={save} pending={update.isPending} />}
    </div>
  );
}

function SupplierAccountHistoryPanel({ history, loading, error, onRetry }: {
  history?: Awaited<ReturnType<typeof import('@workspace/api-client-react').getBusinessCustomerSupplierAccountHistory>>;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading) return <section className="mt-5 rounded-xl border border-border bg-card p-5 md:p-6"><LoadingPanel lines={5} /></section>;
  if (error || !history) return <section className="mt-5 rounded-xl border border-border bg-card p-5 md:p-6"><ErrorPanel onRetry={onRetry} /></section>;
  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mono text-[10px] uppercase tracking-[.14em] text-primary">Supplier account</p>
          <h2 className="mt-1 text-lg font-bold">Account history</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">Orders, invoices, payments, retainage, and waiver gates linked to this customer in the active environment.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <AccountMetric label="Invoiced" value={currency.format(history.summary.invoicedAmount)} />
          <AccountMetric label="Paid" value={currency.format(history.summary.paidAmount)} />
          <AccountMetric label="Outstanding" value={currency.format(history.summary.outstandingAmount)} tone={history.summary.outstandingAmount > 0 ? 'orange' : undefined} />
          <AccountMetric label="Retainage" value={currency.format(history.summary.retainageHeld)} />
        </div>
      </div>
      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border/80 bg-secondary/30 p-4">
          <div className="flex items-center gap-2"><ShieldCheck size={15} className="text-primary" /><p className="text-sm font-bold">Payment terms and gates</p></div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <TermValue label="Terms" value={history.terms?.paymentTerms || 'Not configured'} />
            <TermValue label="Retainage" value={`${history.terms?.retainageRequired ?? 0}%`} />
            <TermValue label="Waiver" value={history.terms?.waiverRequired ? 'Required' : 'Not required'} />
          </div>
          {history.summary.blockedAmount > 0 && <p className="mt-3 flex items-start gap-2 text-xs font-semibold text-amber-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{currency.format(history.summary.blockedAmount)} is held behind an unresolved payment gate.</p>}
        </div>
        <div className="rounded-lg border border-border/80 bg-secondary/30 p-4">
          <div className="flex items-center gap-2"><FileText size={15} className="text-primary" /><p className="text-sm font-bold">Linked controls</p></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <TermValue label="Orders" value={String(history.summary.orderCount)} />
            <TermValue label="Invoices" value={String(history.summary.invoiceCount)} />
            <TermValue label="Payable now" value={currency.format(history.summary.payableAmount)} />
            <TermValue label="Payment events" value={String(history.paymentEvents.length)} />
          </div>
        </div>
      </div>
      {history.orders.length ? <div className="space-y-3">
        {history.orders.map((order) => <AccountOrder key={order.orderId} order={order} />)}
      </div> : <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center"><FileText className="mx-auto mb-3 text-muted-foreground" size={20} /><p className="text-sm font-semibold">No supplier account activity</p><p className="mt-1 text-xs text-muted-foreground">Supplier orders and invoices connected to this customer will appear here.</p></div>}
      {history.paymentEvents.length > 0 && <div className="mt-5 border-t border-border pt-4"><p className="mono mb-2 text-[10px] uppercase tracking-[.14em] text-muted-foreground">Payment timeline</p><div className="grid gap-2 md:grid-cols-2">{history.paymentEvents.slice(0, 6).map((event) => <div key={event.id} className="flex items-start gap-2 rounded-lg border border-border/70 p-3 text-xs"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" /><div><p className="font-semibold">{event.action.replaceAll('_', ' ')}</p><p className="mt-1 text-muted-foreground">{event.details || 'Supplier account activity'} · {shortDate(event.createdAt)}</p></div></div>)}</div></div>}
    </section>
  );
}

function AccountMetric({ label, value, tone }: { label: string; value: string; tone?: 'orange' }) {
  return <div className="rounded-lg border border-border/70 bg-background px-3 py-2"><p className="mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">{label}</p><p className={`mt-1 text-sm font-bold ${tone === 'orange' ? 'text-amber-700' : ''}`}>{value}</p></div>;
}

function TermValue({ label, value }: { label: string; value: string }) {
  return <div><p className="mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function AccountOrder({ order }: { order: Awaited<ReturnType<typeof import('@workspace/api-client-react').getBusinessCustomerSupplierAccountHistory>>['orders'][number] }) {
  return <div className="rounded-lg border border-border/80 p-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="mono text-[10px] text-accent">{order.orderNumber}</p><p className="mt-1 text-sm font-bold">{order.projectName || 'Unassigned project'}</p><p className="mt-1 text-xs text-muted-foreground">{order.commitmentNumber ? `Commitment ${order.commitmentNumber}` : 'No commitment linked'} · {order.orderStatus.replaceAll('_', ' ')}</p></div>
      <div className="text-left sm:text-right"><p className="mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">Order value</p><p className="mt-1 text-sm font-bold">{currency.format(order.totalSell)}</p><Badge tone={order.paymentStatus === 'paid' ? 'green' : order.paymentStatus === 'past_due' ? 'red' : 'orange'}>{order.paymentStatus.replaceAll('_', ' ')}</Badge></div>
    </div>
    {order.invoices.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground"><th className="pb-2 pr-3 font-semibold">Invoice</th><th className="pb-2 pr-3 font-semibold">Total</th><th className="pb-2 pr-3 font-semibold">Paid</th><th className="pb-2 pr-3 font-semibold">Outstanding</th><th className="pb-2 pr-3 font-semibold">Reference</th><th className="pb-2 font-semibold">Gate</th></tr></thead><tbody>{order.invoices.map((invoice) => <AccountInvoice key={invoice.id} invoice={invoice} />)}</tbody></table></div>}
  </div>;
}

function AccountInvoice({ invoice }: { invoice: SupplierAccountInvoice }) {
  const blocked = invoice.paymentGate.status === 'blocked' && invoice.payableAmount > 0;
  return <tr className="border-b border-border/60 last:border-0"><td className="py-3 pr-3 align-top"><p className="font-semibold">{invoice.invoiceNumber}</p><p className="mt-1 text-muted-foreground">{invoice.dueDate ? `Due ${shortDate(invoice.dueDate)}` : 'No due date'}</p></td><td className="py-3 pr-3 align-top">{currency.format(invoice.totalAmount)}{invoice.retainageAmount > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{currency.format(invoice.retainageAmount)} retained</p>}</td><td className="py-3 pr-3 align-top">{currency.format(invoice.paidAmount)}{invoice.paymentReference && <p className="mt-1 text-[10px] text-muted-foreground">{invoice.paymentReference}</p>}</td><td className="py-3 pr-3 align-top font-semibold">{currency.format(invoice.outstandingAmount)}</td><td className="py-3 pr-3 align-top">{invoice.paymentReference || '—'}</td><td className="py-3 align-top"><Badge tone={blocked ? 'orange' : 'green'}>{blocked ? 'Blocked' : 'Ready'}</Badge>{blocked && <p className="mt-1 max-w-[180px] text-[10px] text-amber-700">{invoice.paymentGate.reasons.join(' · ')}</p>}</td></tr>;
}

function CustomerEditModal({ customer, onClose, onSave, pending }: { customer: BusinessCustomer; onClose: () => void; onSave: (data: BusinessCustomerInput) => void; pending: boolean }) {
  const [form, setForm] = useState<BusinessCustomerInput>({ companyName: customer.companyName, customerType: customer.customerType, primaryContact: customer.primaryContact || undefined, email: customer.email || undefined, phone: customer.phone || undefined });
  return <Modal title="Edit business customer" onClose={onClose}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(form); }}><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Company name</span><Input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className={inputClass} /></label><div className="grid gap-4 md:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Customer type</span><select aria-label="Customer type" value={form.customerType || 'business'} onChange={(e) => setForm({ ...form, customerType: e.target.value })} className={inputClass}>{customerTypeOptions(form.customerType).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Primary contact</span><Input value={form.primaryContact || ''} onChange={(e) => setForm({ ...form, primaryContact: e.target.value })} className={inputClass} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span><Input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Phone</span><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} /></label></div><div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button></div></form></Modal>;
}