import { useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import {
  BusinessCustomerInput,
  useListBusinessCustomers,
  getListBusinessCustomersQueryKey,
} from '@workspace/api-client-react';
import { useTenant } from '@/providers/tenant-provider';

type CustomerOption = {
  id: number;
  companyName: string;
  projectCount?: number;
};

export function CustomerSelector({
  value,
  selectedId,
  draft,
  onSelect,
  onDraftChange,
  allowCreate = true,
  required = true,
}: {
  value: string;
  selectedId?: number;
  draft?: BusinessCustomerInput;
  onSelect: (customer?: CustomerOption) => void;
  onDraftChange: (draft?: BusinessCustomerInput) => void;
  allowCreate?: boolean;
  required?: boolean;
}) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const { activeRole } = useTenant();
  const canCreate = allowCreate && (activeRole === 'owner' || activeRole === 'admin');
  const customers = useListBusinessCustomers(search ? { search } : undefined, {
    query: {
      queryKey: getListBusinessCustomersQueryKey(search ? { search } : undefined),
      enabled: open,
    },
  });
  const selected = customers.data?.find((customer) => customer.id === selectedId);

  return (
    <div className="relative md:col-span-2">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Business customer</span>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
        <input
          data-testid="input-business-customer"
          value={draft?.companyName ?? (selected?.companyName || value || search)}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            onSelect(undefined);
            onDraftChange(undefined);
            setOpen(true);
          }}
          placeholder="Search customers or type a new company"
          required={required}
          className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-10 text-sm outline-none ring-primary/20 placeholder:text-muted-foreground/55 focus:ring-4"
        />
        {(selectedId || draft) && (
          <button
            type="button"
            aria-label="Clear selected customer"
            className="absolute right-3 top-2.5 text-muted-foreground"
            onClick={() => {
              onSelect(undefined);
              onDraftChange(undefined);
              setSearch('');
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      {open && (
        <div role="listbox" aria-label="Business customer results" className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card p-1 shadow-xl">
          {customers.data?.map((customer) => (
            <button
              type="button"
              role="option"
              aria-selected={customer.id === selectedId}
              key={customer.id}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
              onClick={() => {
                onSelect(customer);
                onDraftChange(undefined);
                setSearch(customer.companyName);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{customer.companyName}</span>
              {customer.projectCount !== undefined && <span className="text-[10px] text-muted-foreground">{customer.projectCount} projects</span>}
              {customer.id === selectedId && <Check size={14} className="text-primary" />}
            </button>
          ))}
          {canCreate && search.trim() && !customers.data?.some((customer) => customer.companyName.toLowerCase() === search.trim().toLowerCase()) && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border-t border-border px-3 py-2.5 text-left text-sm font-semibold text-primary hover:bg-primary/5"
              onClick={() => {
                onSelect(undefined);
                onDraftChange({ companyName: search.trim() });
                setOpen(false);
              }}
            >
              <Plus size={14} /> Create “{search.trim()}”
            </button>
          )}
          {customers.isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Searching customers…</p>}
          {!customers.isLoading && !customers.data?.length && !canCreate && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matching active customers.</p>
          )}
        </div>
      )}
      {draft && (
        <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-primary">New customer details</p>
            <button type="button" aria-label="Remove new customer draft" onClick={() => onDraftChange(undefined)}><X size={14} /></button>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Primary contact
              <input aria-label="Primary contact" value={draft.primaryContact ?? ''} onChange={(event) => onDraftChange({ ...draft, primaryContact: event.target.value })} placeholder="Primary contact" className="rounded-md border border-input bg-background px-2.5 py-2 text-xs" />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Email
              <input aria-label="Customer email" type="email" value={draft.email ?? ''} onChange={(event) => onDraftChange({ ...draft, email: event.target.value })} placeholder="Email" className="rounded-md border border-input bg-background px-2.5 py-2 text-xs" />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Phone
              <input aria-label="Customer phone" value={draft.phone ?? ''} onChange={(event) => onDraftChange({ ...draft, phone: event.target.value })} placeholder="Phone" className="rounded-md border border-input bg-background px-2.5 py-2 text-xs" />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">This customer is created with the record so the form stays safe to cancel.</p>
        </div>
      )}
    </div>
  );
}