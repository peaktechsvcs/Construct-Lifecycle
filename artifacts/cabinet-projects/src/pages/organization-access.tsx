import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, UserMinus, Users } from 'lucide-react';
import {
  CreateTenantInvitationInputRole,
  InvitationDeliveryOutcome,
  TenantMemberRole,
  useCreateTenantInvitation,
  useListTenantInvitations,
  useListTenantMembers,
  useRemoveTenantMember,
  useRevokeTenantInvitation,
  useUpdateTenantMember,
  getListTenantInvitationsQueryKey,
  getListTenantMembersQueryKey,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';
import { useTenant } from '@/providers/tenant-provider';

const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20';

export function OrganizationAccess({
  title = 'Access & Memberships',
  description = 'Manage members and invitations for your customer workspace.',
  showPageTitle = true,
}: {
  title?: string;
  description?: string;
  showPageTitle?: boolean;
}) {
  const { activeTenant } = useTenant();
  const qc = useQueryClient();
  const members = useListTenantMembers({ query: { queryKey: getListTenantMembersQueryKey() } });
  const invitations = useListTenantInvitations({ query: { queryKey: getListTenantInvitationsQueryKey() } });
  const update = useUpdateTenantMember();
  const remove = useRemoveTenantMember();
  const create = useCreateTenantInvitation();
  const revoke = useRevokeTenantInvitation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CreateTenantInvitationInputRole>('member');
  const [link, setLink] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<InvitationDeliveryOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListTenantMembersQueryKey() });
    qc.invalidateQueries({ queryKey: getListTenantInvitationsQueryKey() });
  };
  const busy = update.isPending || remove.isPending || create.isPending || revoke.isPending;
  if (members.isLoading || invitations.isLoading) return <>{showPageTitle && <PageTitle eyebrow="Settings / Administration" title={title} description={description} />}<LoadingPanel lines={6} /></>;
  if (members.isError || invitations.isError) return <ErrorPanel onRetry={() => { members.refetch(); invitations.refetch(); }} />;
  if (activeTenant && activeTenant.role !== 'owner' && activeTenant.role !== 'admin') return <EmptyState icon={Users} title="Administrator access required" text="Only customer owners and administrators can manage workspace access." />;
  const pending = (invitations.data ?? []).filter((item) => item.status === 'pending');
  return (
    <div className="animate-rise">
      {showPageTitle && <PageTitle eyebrow="Settings / Administration" title={title} description={description} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Users size={16} /></span><h2 className="text-base font-bold">Members</h2></div>
          <div className="space-y-3">
            {(members.data ?? []).length === 0 ? <EmptyState icon={Users} title="No members yet" text="Invite your first teammate below." /> : (members.data ?? []).map((member) => (
              <div key={member.userId} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{member.displayName || member.email || `User ${member.userId}`}</p><p className="truncate text-xs text-muted-foreground">{member.email || 'No email available'}</p></div>
                <select aria-label={`Role for ${member.email || member.userId}`} value={member.role} disabled={busy} onChange={(e) => update.mutate({ userId: member.userId, data: { role: e.target.value as TenantMemberRole } }, { onSuccess: refresh })} className="rounded-lg border border-input bg-background px-2 py-2 text-xs">
                  {Object.values(TenantMemberRole).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <Button variant="danger" aria-label={`Remove ${member.email || 'member'}`} disabled={busy || member.role === 'owner'} onClick={() => window.confirm('Remove this member?') && remove.mutate({ userId: member.userId }, { onSuccess: refresh })}><UserMinus size={14} /> Remove</Button>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Mail size={16} /></span><h2 className="text-base font-bold">Invite someone</h2></div>
             <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setLink(null); setDelivery(null); setCopied(false); create.mutate({ data: { email, role } }, { onSuccess: (result) => { setEmail(''); setDelivery(result.delivery); setLink(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation/${result.token}`); refresh(); } }); }}>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email address</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="teammate@company.com" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Role</span><select value={role} onChange={(e) => setRole(e.target.value as CreateTenantInvitationInputRole)} className={inputClass}>{Object.values(CreateTenantInvitationInputRole).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <Button type="submit" disabled={busy}><Mail size={15} /> {create.isPending ? 'Creating invitation…' : 'Create invitation'}</Button>
            {create.isError && <p role="alert" className="text-xs text-destructive">Invitation could not be created. Try again.</p>}
          </form>
           {link && <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
             <p role="status" className={`text-xs font-semibold ${delivery === 'sent' ? 'text-status-success' : delivery === 'failed' ? 'text-status-danger' : 'text-status-warning'}`}>
               {delivery === 'sent' && 'Invitation email sent.'}
               {delivery === 'failed' && 'Email delivery failed; the invitation is still pending.'}
               {delivery === 'not_configured' && 'Email delivery is not configured; share the recovery link below.'}
             </p>
             <p className="mt-2 text-xs text-muted-foreground">This one-time recovery link is shown only now and expires in seven days.</p>
             <div className="mt-2 flex gap-2"><input readOnly value={link} aria-label="Invitation link" className={`${inputClass} text-xs`} /><Button variant="outline" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); }}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</Button></div>
           </div>}
        </section>
      </div>
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-base font-bold">Pending invitations</h2>
        {pending.length === 0 ? <EmptyState icon={Mail} title="No pending invitations" text="New invitations will appear here." /> : <div className="space-y-2">{pending.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 border-b border-border/60 py-3 last:border-0"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.email}</p><p className="text-xs text-muted-foreground">Expires {new Date(item.expiresAt).toLocaleDateString()}</p></div><Badge tone="violet">{item.role}</Badge><Button variant="ghost" disabled={busy} onClick={() => revoke.mutate({ invitationId: item.id }, { onSuccess: refresh })}>Revoke</Button></div>)}</div>}
      </section>
    </div>
  );
}