import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Archive, Building2, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import {
  BusinessCustomer,
  BusinessCustomerInput,
  getGetBusinessCustomerQueryKey,
  useGetBusinessCustomer,
  useUpdateBusinessCustomer,
} from '@workspace/api-client-react';
import { Badge, Button, currency, ErrorPanel, LoadingPanel, Modal, PageTitle, shortDate } from '@/components/app-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/providers/tenant-provider';
import { useWorkflow } from '@/hooks/use-workflow';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Button as DesignButton } from '@workspace/construct-lifecycle-design-system/components/ui/button';

const inputClass = 'h-10 bg-background';

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const [showEdit, setShowEdit] = useState(false);
  const query = useGetBusinessCustomer(customerId, { query: { queryKey: getGetBusinessCustomerQueryKey(customerId), enabled: Number.isFinite(customerId) } });
  const update = useUpdateBusinessCustomer();
  const qc = useQueryClient();
  const { activeRole } = useTenant();
  const canManage = activeRole === 'owner' || activeRole === 'admin';
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
         action={canManage ? <div className="flex gap-2"><Button variant="outline" onClick={() => setShowEdit(true)}><Pencil size={15} /> Edit</Button><DesignButton asChild><Link href={`/projects?customerId=${customer.id}`}><Plus size={15} /> New project</Link></DesignButton></div> : <DesignButton asChild><Link href={`/projects?customerId=${customer.id}`}><Plus size={15} /> New project</Link></DesignButton>}
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
      {showEdit && <CustomerEditModal customer={customer} onClose={() => setShowEdit(false)} onSave={save} pending={update.isPending} />}
    </div>
  );
}

function CustomerEditModal({ customer, onClose, onSave, pending }: { customer: BusinessCustomer; onClose: () => void; onSave: (data: BusinessCustomerInput) => void; pending: boolean }) {
  const [form, setForm] = useState<BusinessCustomerInput>({ companyName: customer.companyName, customerType: customer.customerType, primaryContact: customer.primaryContact || undefined, email: customer.email || undefined, phone: customer.phone || undefined });
  return <Modal title="Edit business customer" onClose={onClose}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(form); }}><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Company name</span><Input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className={inputClass} /></label><div className="grid gap-4 md:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Customer type</span><Input value={form.customerType || ''} onChange={(e) => setForm({ ...form, customerType: e.target.value })} className={inputClass} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Primary contact</span><Input value={form.primaryContact || ''} onChange={(e) => setForm({ ...form, primaryContact: e.target.value })} className={inputClass} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span><Input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Phone</span><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} /></label></div><div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button></div></form></Modal>;
}