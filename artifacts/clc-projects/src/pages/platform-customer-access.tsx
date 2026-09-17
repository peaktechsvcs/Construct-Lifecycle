import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleUserRound, Clock3, Copy, History, Mail, Save, Trash2, XCircle } from 'lucide-react';
import {
  BusinessType,
  PlatformCustomerAuditEvent,
  PlatformCustomerDetails,
  getGetPlatformCustomerQueryKey,
  getListPlatformCustomerAuditEventsQueryKey,
  getListPlatformCustomersQueryKey,
  useCreatePlatformCustomerInvitation,
  useListPlatformCustomerAuditEvents,
  useRevokePlatformCustomerInvitation,
  useRemovePlatformCustomerMember,
  useUpdatePlatformCustomer,
  useUpdatePlatformCustomerMember,
} from '@workspace/api-client-react';
import { Badge, Button } from '@/components/app-ui';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/business-profile';

const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20';
type CustomerRole = 'owner' | 'admin' | 'member' | 'viewer';

export function PlatformCustomerAccess({
  tenantId,
  details,
  initialOwnerEmail = null,
  onInvitationCreated,
}: {
  tenantId: number;
  details: PlatformCustomerDetails;
  initialOwnerEmail?: string | null;
  onInvitationCreated?: () => void;
}) {
  const qc = useQueryClient();
  const invite = useCreatePlatformCustomerInvitation();
  const revoke = useRevokePlatformCustomerInvitation();
  const updateCustomer = useUpdatePlatformCustomer();
  const audit = useListPlatformCustomerAuditEvents(tenantId, {
    query: { queryKey: getListPlatformCustomerAuditEventsQueryKey(tenantId) },
  });
  const [email, setEmail] = useState(initialOwnerEmail ?? '');
  const [role, setRole] = useState<CustomerRole>(initialOwnerEmail ? 'owner' : 'member');
  const [retryingOwnerInvitation, setRetryingOwnerInvitation] = useState(Boolean(initialOwnerEmail));
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const customer = details.customer;
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>(customer.businessTypes);

  useEffect(() => {
    if (initialOwnerEmail) {
      setEmail(initialOwnerEmail);
      setRole('owner');
      setRetryingOwnerInvitation(true);
      setInviteLink(null);
      setCopied(false);
    } else {
      if (retryingOwnerInvitation) {
        setEmail('');
        setRole('member');
        setInviteLink(null);
        setCopied(false);
      }
      setRetryingOwnerInvitation(false);
    }
  }, [initialOwnerEmail, retryingOwnerInvitation, tenantId]);

  useEffect(() => {
    setBusinessTypes(customer.businessTypes);
  }, [customer.businessTypes]);

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
          setRole('member');
          setRetryingOwnerInvitation(false);
          setInviteLink(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation/${result.token}`);
          onInvitationCreated?.();
          refresh();
        },
      },
    );
  };

  const toggleBusinessType = (businessType: BusinessType) => {
    setBusinessTypes((current) =>
      current.includes(businessType)
        ? current.filter((item) => item !== businessType)
        : [...current, businessType],
    );
  };

  const saveBusinessTypes = () => {
    if (businessTypes.length === 0) return;
    updateCustomer.mutate(
      { tenantId, data: { status: customer.status, businessTypes } },
      { onSuccess: refresh },
    );
  };

  const revokeInvitation = (invitationId: number, email: string) => {
    if (!window.confirm(`Revoke the pending invitation for ${email}?`)) return;
    revoke.mutate(
      { tenantId, invitationId },
      { onSuccess: refresh },
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

      <div className="mt-5 rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Business type</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the customer workspace roles that should shape its available features.</p>
          </div>
          <Button
            type="button"
            className="px-3 py-2 text-xs"
            disabled={updateCustomer.isPending || businessTypes.length === 0}
            onClick={saveBusinessTypes}
          >
            <Save size={14} /> {updateCustomer.isPending ? 'Saving…' : 'Save business types'}
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {BUSINESS_TYPE_OPTIONS.map((option) => {
            const selected = businessTypes.includes(option.value);
            return (
              <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${selected ? 'border-primary/50 bg-primary/5' : 'border-border bg-card hover:border-primary/40'}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleBusinessType(option.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {businessTypes.length === 0 && <p role="alert" className="mt-2 text-xs text-destructive">Select at least one business type.</p>}
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
            <h3 className="text-sm font-bold">{retryingOwnerInvitation ? 'Retry owner invitation' : 'Invite a user'}</h3>
          </div>
          {retryingOwnerInvitation && <p className="text-xs leading-5 text-muted-foreground">Retry the original owner invitation for this customer. The address and owner role are locked for this retry.</p>}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span>
            <input required readOnly={retryingOwnerInvitation} type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Role</span>
            <select disabled={retryingOwnerInvitation} value={role} onChange={(event) => setRole(event.target.value as CustomerRole)} className={inputClass}>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <Button type="submit" disabled={invite.isPending}><Mail size={14} /> {invite.isPending ? 'Creating…' : retryingOwnerInvitation ? 'Retry owner invitation' : 'Create invitation'}</Button>
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
            {details.invitations.map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
                <span className="min-w-0 truncate">{invitation.email}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={invitation.status === 'pending' ? 'orange' : invitation.status === 'accepted' ? 'green' : 'neutral'}>{invitation.status}</Badge>
                  {invitation.status === 'pending' && (
                    <Button
                      type="button"
                      variant="outline"
                      className="px-2 py-1 text-[11px]"
                      aria-label={`Revoke invitation for ${invitation.email}`}
                      disabled={revoke.isPending}
                      onClick={() => revokeInvitation(invitation.id, invitation.email)}
                    >
                      <XCircle size={13} /> Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {revoke.isError && <p role="alert" className="mt-2 text-xs text-destructive">The invitation could not be revoked. It may no longer be pending.</p>}
        </div>
      )}

      <PlatformAuditTimeline audit={audit.data ?? []} isLoading={audit.isLoading} isError={audit.isError} />
    </section>
  );
}

function auditPersonLabel(person: PlatformCustomerAuditEvent['actor'] | null) {
  return person?.displayName || person?.email || (person ? `User #${person.id}` : 'Unknown user');
}

function auditActionLabel(action: string) {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function auditSummary(event: PlatformCustomerAuditEvent) {
  const affectedUser = auditPersonLabel(event.affectedUser);
  const details = event.details;
  switch (event.action) {
    case 'customer_created':
      return 'Customer workspace created';
    case 'customer_status_changed':
      return `Workspace status changed to ${String(details.status ?? 'updated')}`;
    case 'customer_branding_changed':
      return `Customer branding ${details.customerBrandingEnabled === true ? 'enabled' : 'disabled'}`;
    case 'customer_business_types_changed':
      return `Business types updated to ${Array.isArray(details.businessTypes) ? details.businessTypes.join(', ') : 'updated values'}`;
    case 'customer_member_access_updated':
      return `${affectedUser} access updated to ${String(details.role ?? 'updated')}`;
    case 'customer_member_removed':
      return `${affectedUser} removed from the workspace`;
    case 'customer_invitation_revoked':
      return 'A customer invitation was revoked';
    default:
      return auditActionLabel(event.action);
  }
}

function formatAuditTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function PlatformAuditTimeline({
  audit,
  isLoading,
  isError,
}: {
  audit: PlatformCustomerAuditEvent[];
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="platform-audit-heading" data-testid="platform-audit-timeline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><History size={16} /></span>
          <div>
            <h3 id="platform-audit-heading" className="text-sm font-bold">Access and workspace history</h3>
            <p className="mt-1 text-xs text-muted-foreground">Platform-admin actions for this customer, with the actor and affected workspace or user.</p>
          </div>
        </div>
        <span className="mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">{audit.length} entries</span>
      </div>

      {isLoading && <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">Loading audit history…</p>}
      {isError && <p className="mt-4 rounded-lg border border-status-danger/30 bg-status-danger/5 p-4 text-xs text-destructive" role="alert">Audit history could not be loaded.</p>}
      {!isLoading && !isError && audit.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">No platform access changes have been recorded for this customer.</p>
      )}
      {!isLoading && !isError && audit.length > 0 && (
        <div className="mt-4 space-y-3">
          {audit.map((event, index) => (
            <article key={event.id} className="relative flex gap-3 rounded-lg border border-border bg-background p-4" data-testid={`platform-audit-event-${event.id}`}>
              {index < audit.length - 1 && <span className="absolute bottom-[-13px] left-[21px] z-10 h-3 w-px bg-border" aria-hidden="true" />}
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                <CircleUserRound size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{auditSummary(event)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{auditPersonLabel(event.actor)}</span>
                      {' · '}
                      {event.affectedUser ? `Affected user: ${auditPersonLabel(event.affectedUser)}` : `Workspace: ${event.workspace.name}`}
                    </p>
                  </div>
                  <span className="mono inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock3 size={11} /> {formatAuditTimestamp(event.createdAt)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="mono rounded-md bg-secondary px-2 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">{auditActionLabel(event.action)}</span>
                  <span className="mono text-[10px] text-muted-foreground">{event.workspace.slug}</span>
                </div>
              </div>
            </article>
          ))}
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