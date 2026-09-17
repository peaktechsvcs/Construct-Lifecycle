import { useState } from 'react';
import { Link } from 'wouter';
import { Building2, Archive, Plus, Search } from 'lucide-react';
import {
  BusinessCustomerInput,
  BusinessCustomerStatus,
  getListBusinessCustomersQueryKey,
  useCreateBusinessCustomer,
  useListBusinessCustomers,
  useUpdateBusinessCustomer,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle } from '@/components/app-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/providers/tenant-provider';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Checkbox } from '@workspace/construct-lifecycle-design-system/components/ui/checkbox';
import { CUSTOMER_TYPE_OPTIONS } from '@/lib/customer-type-options';

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring';

export function Customers() {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [form, setForm] = useState<BusinessCustomerInput>({ companyName: '', customerType: 'business' });
  const qc = useQueryClient();
  const { activeRole } = useTenant();
  const canManage = activeRole === 'owner' || activeRole === 'admin';
  const params = { search: search || undefined, includeArchived };
  const query = useListBusinessCustomers(params, { query: { queryKey: getListBusinessCustomersQueryKey(params) } });
  const create = useCreateBusinessCustomer();
  const update = useUpdateBusinessCustomer();
  const refresh = () => qc.invalidateQueries({ queryKey: ['/api/customers'] });

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate({ data: form }, {
      onSuccess: () => {
        setForm({ companyName: '', customerType: 'business' });
        setShowCreate(false);
        refresh();
      },
    });
  };

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Business directory"
        title="Customers"
        description="Keep the business relationship separate from the projects it supports."
        action={canManage ? <Button onClick={() => setShowCreate(true)}><Plus size={16} /> New customer</Button> : undefined}
      />
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row md:items-center">
        <label className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
           <Input data-testid="input-search-customers" aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, contact, or email" className={`h-10 ${inputClass} pl-9`} />
        </label>
        <label className="flex items-center gap-2 px-2 text-xs font-semibold text-muted-foreground">
          <Checkbox checked={includeArchived} onCheckedChange={(checked) => setIncludeArchived(checked === true)} />
          Show archived
        </label>
      </div>
      {query.isLoading ? <LoadingPanel lines={6} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : query.data?.length ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1.6fr_1fr_120px_110px_100px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">
            {['Customer', 'Type', 'Projects', 'Status', ''].map((label) => <span key={label} className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">{label}</span>)}
          </div>
          <div className="divide-y divide-border">
            {query.data.map((customer) => (
              <div key={customer.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1.6fr_1fr_120px_110px_100px] md:items-center md:gap-4">
                <Link href={`/customers/${customer.id}`} className="flex min-w-0 items-center gap-3 hover:text-primary">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><Building2 size={16} /></span>
                  <span className="min-w-0"><span className="block truncate text-sm font-bold">{customer.companyName}</span><span className="text-xs text-muted-foreground">Open customer record</span></span>
                </Link>
                <span className="text-xs text-muted-foreground">{customer.customerType}</span>
                <span className="mono text-sm">{customer.projectCount}</span>
                <Badge tone={customer.status === BusinessCustomerStatus.active ? 'green' : 'neutral'}>{customer.status}</Badge>
                {canManage && (
                  <Button
                    variant="ghost"
                    className="justify-self-start px-2 text-xs"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ customerId: customer.id, data: { status: customer.status === 'active' ? 'archived' : 'active' } }, { onSuccess: refresh })}
                  >
                    <Archive size={14} /> {customer.status === 'active' ? 'Archive' : 'Restore'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState icon={Building2} title="No customers match that view" text={search || includeArchived ? 'Try a different search or filter.' : 'Add your first business customer to connect projects to a durable relationship.'} action={canManage ? <Button onClick={() => setShowCreate(true)}><Plus size={15} /> Add customer</Button> : undefined} />
      )}
      {showCreate && (
        <Modal title="Create business customer" onClose={() => setShowCreate(false)}>
          <form onSubmit={save} className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Company name</span><input autoFocus required minLength={1} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className={inputClass} /></label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Customer type</span><select aria-label="Customer type" value={form.customerType ?? 'business'} onChange={(e) => setForm({ ...form, customerType: e.target.value })} className={inputClass}>{CUSTOMER_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Primary contact</span><input value={form.primaryContact ?? ''} onChange={(e) => setForm({ ...form, primaryContact: e.target.value })} className={inputClass} /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span><input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Phone</span><input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} /></label>
            </div>
            {create.isError && <p role="alert" className="text-xs text-destructive">A customer with that name may already exist, or the record could not be saved.</p>}
            <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || !form.companyName.trim()}>{create.isPending ? 'Creating…' : 'Create customer'}</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}