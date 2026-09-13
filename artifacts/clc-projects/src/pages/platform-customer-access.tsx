import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Mail, Save, Trash2 } from 'lucide-react';
import {
  PlatformCustomerDetails,
  getGetPlatformCustomerQueryKey,
  getListPlatformCustomersQueryKey,
  useCreatePlatformCustomerInvitation,
  useRemovePlatformCustomerMember,
  useUpdatePlatformCustomer,
  useUpdatePlatformCustomerMember,
} from '@workspace/api-client-react';
import { Badge, Button } from '@/components/app-ui';

const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20';
type CustomerRole = 'owner' | 'admin' | 'member' | 'viewer';

export function PlatformCustomerAccess({
  tenantId,
  details,
}: {
  tenantId: number;
  details: PlatformCustomerDetails;
}) {
  const qc = useQueryClient();
  const invite = useCreatePlatformCustomerInvitation();
  const updateCustomer = useUpdatePlatformCustomer();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CustomerRole>('member');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const customer = details.customer;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetPlatformCustomerQueryKey(tenantId) });
    qc.invalidateQueries({ queryKey: getListPlatformCustomersQueryKey() });
  };

  const submitInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    invite.mutate(
      { tenantId, data: { email, role } },
      {
        onSuccess: (result) => {
          setEmail('');
          setInviteLink(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation/${result.token}`);
          refresh();
        },
      },
    );
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5" aria-labelledby="customer-access-heading">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="mono text-[10px] font-bold uppercase tracking-[.14em] text-primary">Customer access</p>
          <h2 id="customer-access-heading" className="mt-1 text-base font-bold">{customer.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Manage customer users, environment access, and platform-owned permissions.</p>
        </div>
        <label className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={customer.customerBrandingEnabled}
            disabled={updateCustomer.isPending}
            onChange={(event) => updateCustomer.mutate(
              { tenantId, data: { status: customer.status, customerBrandingEnabled: event.target.checked } },
              { onSuccess: refresh },
            )}
            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          Customer Branding enabled
        </label>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <h3 className="text-sm font-bold">Customer users</h3>
          {details.members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No accepted users yet.</p>
          ) : (
            details.members.map((member) => (
              <CustomerMemberRow
                key={member.userId}
                tenantId={tenantId}
                member={member}
                environments={customer.environments}
                onRefresh={refresh}
              />
            ))
          )}
        </div>

        <form className="h-fit space-y-4 rounded-lg border border-border bg-background p-4" onSubmit={submitInvitation}>
          <div className="flex items-center gap-2">
            <Mail size={15} className="text-primary" />
            <h3 className="text-sm font-bold">Invite a user</h3>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span>
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as CustomerRole)} className={inputClass}>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <Button type="submit" disabled={invite.isPending}><Mail size={14} /> {invite.isPending ? 'Creating…' : 'Create invitation'}</Button>
          {invite.isError && <p role="alert" className="text-xs text-destructive">The invitation could not be created.</p>}
          {inviteLink && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-semibold">One-time invitation link</p>
              <div className="mt-2 flex gap-2">
                <input readOnly value={inviteLink} aria-label="Customer invitation link" className={`${inputClass} min-w-0 text-xs`} />
                <Button type="button" variant="outline" onClick={() => { navigator.clipboard.writeText(inviteLink); setCopied(true); }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}
        </form>
      </div>

      {details.invitations.length > 0 && (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-bold">Invitations</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {details.invitations.slice(0, 6).map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
                <span className="min-w-0 truncate">{invitation.email}</span>
                <Badge tone={invitation.status === 'pending' ? 'orange' : invitation.status === 'accepted' ? 'green' : 'neutral'}>{invitation.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CustomerMemberRow({
  tenantId,
  member,
  environments,
  onRefresh,
}: {
  tenantId: number;
  member: PlatformCustomerDetails['members'][number];
  environments: PlatformCustomerDetails['customer']['environments'];
  onRefresh: () => void;
}) {
  const update = useUpdatePlatformCustomerMember();
  const remove = useRemovePlatformCustomerMember();
  const [role, setRole] = useState<CustomerRole>(member.role as CustomerRole);
  const [environmentIds, setEnvironmentIds] = useState<number[]>(member.environmentIds);

  useEffect(() => {
    setRole(member.role as CustomerRole);
    setEnvironmentIds(member.environmentIds);
  }, [member.role, member.environmentIds]);

  const toggleEnvironment = (environmentId: number) => {
    setEnvironmentIds((current) => current.includes(environmentId)
      ? current.filter((id) => id !== environmentId)
      : [...current, environmentId]);
  };

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{member.displayName || member.email || 'Unnamed user'}</p>
          <p className="truncate text-xs text-muted-foreground">{member.email || 'No email on profile'}</p>
        </div>
        <button
          type="button"
          aria-label={`Remove ${member.email || 'customer member'}`}
          className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => remove.mutate({ tenantId, userId: member.userId }, { onSuccess: onRefresh })}
          disabled={remove.isPending}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[150px_1fr_auto] md:items-end">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as CustomerRole)} className={inputClass}>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Environment access</legend>
          <div className="flex flex-wrap gap-2">
            {environments.map((environment) => (
              <label key={environment.id} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={environmentIds.includes(environment.id)}
                  onChange={() => toggleEnvironment(environment.id)}
                  className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {environment.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending}
          onClick={() => update.mutate(
            { tenantId, userId: member.userId, data: { role, environmentIds } },
            { onSuccess: onRefresh },
          )}
        >
          <Save size={14} /> {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {update.isError && <p role="alert" className="mt-2 text-xs text-destructive">Access changes could not be saved.</p>}
    </div>
  );
}