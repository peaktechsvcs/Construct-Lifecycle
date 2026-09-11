import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, Pause, Play, Plus, ShieldAlert } from 'lucide-react';
import { PlatformCustomerStatus, UpdatePlatformCustomerInputStatus, useCreatePlatformCustomer, useListPlatformCustomers, useUpdatePlatformCustomer, getListPlatformCustomersQueryKey } from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';
const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20';

function isPlatformPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return status === 403;
}

function platformPermissionMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  return 'Platform administrator permission required.';
}

export function PlatformCustomers() {
  const qc = useQueryClient();
  const customers = useListPlatformCustomers({ query: { queryKey: getListPlatformCustomersQueryKey() } });
  const create = useCreatePlatformCustomer();
  const update = useUpdatePlatformCustomer();
  const [name, setName] = useState(''); const [slug, setSlug] = useState(''); const [ownerEmail, setOwnerEmail] = useState(''); const [link, setLink] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  if (customers.isLoading) return <><PageTitle eyebrow="Platform" title="Customers" description="Onboard and control customer workspaces." /><LoadingPanel lines={6} /></>;
  if (customers.isError) {
    if (isPlatformPermissionError(customers.error)) {
      return (
        <div className="animate-rise">
          <PageTitle eyebrow="Platform" title="Customers" description="Onboard and control customer workspaces." />
          <div role="alert" className="rounded-xl border border-status-warning/30 bg-card p-6 shadow-[0_1px_0_hsl(var(--border))]">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-status-warning/10 text-status-warning">
                <ShieldAlert size={19} />
              </span>
              <div>
                <h2 className="text-base font-bold">Platform access required</h2>
                <p className="mt-1 text-sm text-muted-foreground">{platformPermissionMessage(customers.error)}</p>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Ask an existing platform administrator to grant this account access, then retry.
                </p>
                <Button className="mt-4" variant="outline" onClick={() => customers.refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return <ErrorPanel onRetry={() => customers.refetch()} />;
  }
  const refresh = () => qc.invalidateQueries({ queryKey: getListPlatformCustomersQueryKey() });
  return <div className="animate-rise"><PageTitle eyebrow="Platform" title="Customers" description="Onboard and control customer workspaces." /><div className="grid gap-6 lg:grid-cols-[1fr_360px]"><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 text-base font-bold">Customer workspaces</h2>{(customers.data ?? []).length === 0 ? <EmptyState icon={Building2} title="No customers yet" text="Create a customer workspace to get started." /> : <div className="space-y-3">{(customers.data ?? []).map((customer) => <div key={customer.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{customer.name}</p><p className="mono truncate text-[10px] text-muted-foreground">{customer.slug} · {customer.memberCount} members · {customer.pendingInvitationCount} pending</p></div><Badge tone={customer.status === PlatformCustomerStatus.active ? 'green' : 'red'}>{customer.status}</Badge><Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ tenantId: customer.id, data: { status: customer.status === 'active' ? UpdatePlatformCustomerInputStatus.suspended : UpdatePlatformCustomerInputStatus.active } }, { onSuccess: refresh })}>{customer.status === 'active' ? <><Pause size={14} /> Suspend</> : <><Play size={14} /> Reactivate</>}</Button></div>)}</div>}</section><section className="rounded-xl border border-border bg-card p-5"><div className="mb-5 flex items-center gap-3 border-b border-border pb-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Plus size={16} /></span><h2 className="text-base font-bold">Create customer</h2></div><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ data: { name, slug, ownerEmail: ownerEmail || null } }, { onSuccess: (result) => { setName(''); setSlug(''); setOwnerEmail(''); refresh(); if (result.invitationToken) setLink(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation/${result.invitationToken}`); } }); }}><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Customer name</span><input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Slug</span><input required pattern="[a-z0-9][a-z0-9-]{2,62}" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className={inputClass} placeholder="acme-builders" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner email <span className="font-normal text-muted-foreground">(optional)</span></span><input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className={inputClass} /></label><Button type="submit" disabled={create.isPending}><Plus size={15} /> {create.isPending ? 'Creating…' : 'Create customer'}</Button>{create.isError && <p role="alert" className="text-xs text-destructive">Customer could not be created. Try again.</p>}</form>{link && <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-semibold">One-time owner invitation link</p><div className="mt-2 flex gap-2"><input readOnly value={link} aria-label="Owner invitation link" className={`${inputClass} text-xs`} /><Button variant="outline" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); }}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</Button></div></div>}</section></div></div>;
}