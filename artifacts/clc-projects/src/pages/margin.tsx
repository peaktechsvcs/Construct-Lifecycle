import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, ArrowDown, ArrowUp, CircleDollarSign, Percent, Search, ShoppingCart, Truck } from 'lucide-react';
import {
  getGetProjectControlsDashboardQueryKey,
  getListSupplierOrdersQueryKey,
  getListSupplierQuotesQueryKey,
  useGetProjectControlsDashboard,
  useListSupplierOrders,
  useListSupplierQuotes,
  type SupplierOrder,
  type SupplierQuote,
} from '@workspace/api-client-react';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Badge, EmptyState, ErrorPanel, LoadingPanel, PageTitle, StatCard, currency, shortDate } from '@/components/app-ui';
import { useRouteMetadata, routeMetadata } from '@/lib/route-titles';

type RecordKind = 'all' | 'quote' | 'order';
type SortKey = 'marginPercent' | 'grossMargin' | 'updatedAt';
type MarginRecord = {
  id: number; kind: 'quote' | 'order'; number: string; customer: string; status: string;
  cost: number; sell: number; margin: number; updatedAt: string;
};

const closedStatuses = new Set(['closed', 'canceled', 'rejected', 'expired']);
const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
const money = (value: number) => currency.format(value);
const percentage = (margin: number, sell: number) => sell > 0 ? `${Math.round((margin / sell) * 100)}%` : '—';
const statusTone = (status: string): 'green' | 'orange' | 'red' | 'neutral' =>
  ['accepted', 'converted', 'fulfilled', 'paid'].includes(status) ? 'green' :
  ['rejected', 'expired', 'canceled', 'closed'].includes(status) ? 'red' :
  ['sent', 'approved', 'purchasing', 'partially_fulfilled'].includes(status) ? 'orange' : 'neutral';

function toRecords(quotes: SupplierQuote[], orders: SupplierOrder[]): MarginRecord[] {
  return [
    ...quotes.map((item) => ({ id: item.id, kind: 'quote' as const, number: item.quoteNumber, customer: item.customerName, status: item.status, cost: item.totalCost, sell: item.totalSell, margin: item.grossMargin, updatedAt: item.updatedAt })),
    ...orders.map((item) => ({ id: item.id, kind: 'order' as const, number: item.orderNumber, customer: item.customerName, status: item.orderStatus, cost: item.totalCost, sell: item.totalSell, margin: item.grossMargin, updatedAt: item.updatedAt })),
  ];
}

export function Margin() {
  useRouteMetadata(routeMetadata.margin);
  const quotes = useListSupplierQuotes(undefined, { query: { queryKey: getListSupplierQuotesQueryKey(), retry: false } });
  const orders = useListSupplierOrders(undefined, { query: { queryKey: getListSupplierOrdersQueryKey(), retry: false } });
  const controls = useGetProjectControlsDashboard({ query: { queryKey: getGetProjectControlsDashboardQueryKey(), staleTime: 60000, retry: false } });
  const [kind, setKind] = useState<RecordKind>('all');
  const [search, setSearch] = useState('');
  const [excludeClosed, setExcludeClosed] = useState(true);
  const [sort, setSort] = useState<SortKey>('marginPercent');
  const [descending, setDescending] = useState(true);

  const records = useMemo(() => {
    const query = search.trim().toLowerCase();
    return toRecords(quotes.data ?? [], orders.data ?? [])
      .filter((record) => kind === 'all' || record.kind === kind)
      .filter((record) => !excludeClosed || !closedStatuses.has(record.status))
      .filter((record) => !query || record.number.toLowerCase().includes(query) || record.customer.toLowerCase().includes(query))
      .sort((a, b) => {
        const av = sort === 'marginPercent' ? (a.sell > 0 ? a.margin / a.sell : -Infinity) : sort === 'grossMargin' ? a.margin : new Date(a.updatedAt).getTime();
        const bv = sort === 'marginPercent' ? (b.sell > 0 ? b.margin / b.sell : -Infinity) : sort === 'grossMargin' ? b.margin : new Date(b.updatedAt).getTime();
        return (av - bv) * (descending ? -1 : 1);
      });
  }, [quotes.data, orders.data, kind, search, excludeClosed, sort, descending]);

  const allRecords = useMemo(() => toRecords(quotes.data ?? [], orders.data ?? []), [quotes.data, orders.data]);
  const riskCount = allRecords.filter((record) => record.sell <= 0 || record.margin < 0 || (record.sell > 0 && record.margin / record.sell < 0.1)).length;
  const bothRecordSourcesFailed = quotes.isError && orders.isError;
  const loaded = !quotes.isLoading && !orders.isLoading;
  const controlsMarginPercent = controls.data && controls.data.contractValue > 0 ? `${Math.round((controls.data.forecastMargin / controls.data.contractValue) * 100)}%` : '—';
  const setSortKey = (next: SortKey) => next === sort ? setDescending((value) => !value) : (setSort(next), setDescending(true));

  return (
    <div className="animate-rise space-y-6">
      <div data-testid="margin-page-heading"><PageTitle eyebrow="Financial workspace" title="Margin" description="See which quoted and purchased work is profitable, where forecast margin stands, and which records deserve attention." /></div>
      <p data-testid="margin-basis-statement" className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        Basis: margin percentage is gross margin dollars divided by sell value. Records with zero or negative sell value show an em dash.
      </p>
      <section data-testid="margin-summary-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Forecast margin" value={controls.data ? money(controls.data.forecastMargin) : '—'} detail={controls.data ? `${controlsMarginPercent} of contract value` : 'Project controls unavailable'} icon={CircleDollarSign} accent="green" />
        <StatCard label="Contract value" value={controls.data ? money(controls.data.contractValue) : '—'} detail={controls.data ? `${controls.data.activeProjects} active projects` : 'Project controls unavailable'} icon={Percent} accent="teal" />
        <StatCard label="Visible records" value={loaded ? String(records.length) : '—'} detail={`${quotes.data?.length ?? 0} quotes · ${orders.data?.length ?? 0} orders`} icon={ShoppingCart} accent="violet" />
        <StatCard label="Margin risks" value={loaded ? String(riskCount) : '—'} detail="Negative, below 10%, or no sell basis" icon={AlertTriangle} accent="orange" />
      </section>
      {controls.isError && <ErrorPanel title="Forecast controls unavailable" text="Current project forecast metrics could not be loaded. Record margin analysis remains available." onRetry={() => { void controls.refetch(); }} />}
      {(quotes.isError || orders.isError) && !bothRecordSourcesFailed && (
        <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/8 px-4 py-3 text-sm text-status-warning">
          {quotes.isError ? 'Supplier quotes are temporarily unavailable.' : 'Purchase orders are temporarily unavailable.'} The available records remain visible below.
        </p>
      )}
      <section className="rounded-xl border border-border bg-card p-4 md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Margin register</p>
            <h2 className="mt-1 text-lg font-bold">Quoted and purchased work</h2>
          </div>
          <div data-testid="margin-filter-controls" className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative w-full min-w-0 sm:w-64"><Search size={15} className="absolute left-3 top-3 text-muted-foreground" /><Input data-testid="input-margin-search" aria-label="Search margin records" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number or customer" className={`${inputClass} pl-9`} /></label>
            <div role="group" aria-label="Record type" className="grid grid-cols-3 rounded-md border border-border bg-secondary p-1">
              {(['all', 'quote', 'order'] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`rounded px-3 py-2 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kind === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{value === 'all' ? 'All' : value === 'quote' ? 'Supplier quotes' : 'Purchase orders'}</button>)}
            </div>
            <label className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-muted-foreground"><input type="checkbox" checked={excludeClosed} onChange={(event) => setExcludeClosed(event.target.checked)} /> Hide closed/rejected</label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs">
          <span className="font-semibold text-muted-foreground">Sort visible records:</span>
          {([['marginPercent', 'Margin %'], ['grossMargin', 'Gross margin $'], ['updatedAt', 'Updated']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setSortKey(value)} aria-pressed={sort === value} className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sort === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-secondary'}`}>{label}{sort === value && (descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button>)}
        </div>
        {bothRecordSourcesFailed ? <ErrorPanel title="Margin records unavailable" text="Quotes and purchase orders could not be loaded. Retry to restore the register." onRetry={() => { void quotes.refetch(); void orders.refetch(); }} /> : !loaded ? <LoadingPanel lines={6} /> : records.length === 0 ? <EmptyState icon={Truck} title="No margin records match" text={allRecords.length ? 'Try changing the record type, search, or closed-record filter.' : 'Supplier quotes and purchase orders with cost and sell values will appear here.'} /> : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-border text-[10px] uppercase tracking-[.1em] text-muted-foreground"><th className="px-3 py-3">Record</th><th className="px-3 py-3">Customer</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Sell value</th><th className="px-3 py-3 text-right">Gross margin</th><th className="px-3 py-3 text-right">Margin %</th><th className="px-3 py-3 text-right">Updated</th></tr></thead>
              <tbody>{records.map((record) => {
                const risk = record.sell <= 0 || record.margin < 0 || (record.sell > 0 && record.margin / record.sell < 0.1);
                const href = record.kind === 'quote' ? `/procurement?tab=quotes&quote=${record.id}` : `/purchase-orders?order=${record.id}`;
                return <tr key={`${record.kind}-${record.id}`} data-testid={`margin-record-${record.kind}-${record.id}`} className={`border-b border-border/70 last:border-0 ${risk ? 'bg-status-warning/5' : ''}`}>
                  <td className="px-3 py-3"><Link href={href} className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{record.number}</Link><span className="mt-1 block text-[11px] text-muted-foreground">{record.kind === 'quote' ? 'Supplier quote' : 'Purchase order'}</span></td>
                  <td className="px-3 py-3 font-medium">{record.customer}</td><td className="px-3 py-3"><Badge tone={statusTone(record.status)}>{record.status.replaceAll('_', ' ')}</Badge></td>
                  <td className="px-3 py-3 text-right font-medium">{money(record.sell)}</td><td className={`px-3 py-3 text-right font-bold ${record.margin < 0 ? 'text-status-danger' : ''}`}>{money(record.margin)}</td><td className={`px-3 py-3 text-right font-bold ${risk ? 'text-status-warning' : 'text-status-success'}`}>{percentage(record.margin, record.sell)}</td><td className="mono px-3 py-3 text-right text-xs text-muted-foreground">{shortDate(record.updatedAt)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}