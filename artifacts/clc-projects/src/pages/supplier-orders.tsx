import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ClipboardList,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Truck,
  Upload,
  Warehouse,
} from 'lucide-react';
import {
  getGetSupplierDeliveryProofUrl,
  getGetSupplierOrderQueryKey,
  getGetSupplierQuoteQueryKey,
  getListBusinessCustomersQueryKey,
  getListSupplierCustomerTermsQueryKey,
  getListSupplierOrdersQueryKey,
  getListSupplierProductsQueryKey,
  getListSupplierQuotesQueryKey,
  getListSupplierVendorsQueryKey,
  getListSupplierOrderEventsQueryKey,
  useCreateSupplierDelivery,
  useCreateSupplierInvoice,
  useCreateSupplierCustomerTerms,
  useCreateSupplierProduct,
  useCreateSupplierQuote,
  useCreateSupplierVendor,
  useRecordSupplierReceiving,
  useRequestSupplierDeliveryProofUpload,
  useCompleteSupplierDeliveryProofUpload,
  useGetSupplierOrder,
  useGetSupplierQuote,
  useListBusinessCustomers,
  useListSupplierCustomerTerms,
  useListSupplierOrders,
  useListSupplierProducts,
  useListSupplierQuotes,
  useListSupplierVendors,
  useListSupplierOrderEvents,
  useConvertSupplierQuote,
  useUpdateSupplierOrder,
} from '@workspace/api-client-react';
import type {
  SupplierOrder,
  SupplierDelivery,
  SupplierDeliveryLine,
  SupplierOrderLine,
  SupplierOrderStatus,
  SupplierProduct,
  SupplierQuote,
  SupplierQuoteStatus,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle, StatCard, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring';
const tabs = [
  { value: 'overview', label: 'Overview', icon: Warehouse },
  { value: 'catalog', label: 'Catalog & terms', icon: Package },
  { value: 'quotes', label: 'Quotes', icon: Receipt },
  { value: 'orders', label: 'Orders & fulfillment', icon: Truck },
] as const;

type Tab = typeof tabs[number]['value'];
type RouteMode = 'procurement' | 'purchase-orders' | 'deliveries' | 'receiving';
type ReceivingDraft = {
  received: string;
  damaged: string;
  short: string;
  returned: string;
  accepted: boolean;
  note: string;
};

const maxDeliveryProofSize = 25 * 1024 * 1024;
const allowedDeliveryProofTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif']);

function statusTone(status: string): 'green' | 'orange' | 'red' | 'teal' | 'neutral' {
  if (['fulfilled', 'paid', 'accepted', 'approved', 'delivered', 'active'].includes(status)) return 'green';
  if (['exception', 'past_due', 'rejected', 'canceled', 'disputed'].includes(status)) return 'red';
  if (['purchasing', 'partially_fulfilled', 'sent', 'submitted', 'invoiced', 'partial', 'in_transit'].includes(status)) return 'orange';
  if (['converted', 'order_received'].includes(status)) return 'teal';
  return 'neutral';
}

function labelStatus(status: string) {
  return status.replaceAll('_', ' ');
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground"><span>{label}</span>{children}</label>;
}

function Section({ eyebrow, title, action, children }: { eyebrow: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mono text-[9px] font-bold uppercase tracking-[.15em] text-primary">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function money(value: number) {
  return currency.format(value);
}

function positiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function SupplierOrders() {
  const qc = useQueryClient();
  const [location, setLocation] = useLocation();
  const pathname = useMemo(() => location.split('?')[0] || '/procurement', [location]);
  const routeParams = useMemo(() => new URLSearchParams(location.split('?')[1] ?? ''), [location]);
  const routeMode = useMemo<RouteMode>(() => {
    if (pathname === '/purchase-orders') return 'purchase-orders';
    if (pathname === '/deliveries') return 'deliveries';
    if (pathname === '/receiving') return 'receiving';
    return 'procurement';
  }, [pathname]);
  const routeTab = useMemo<Tab>(() => {
    if (pathname === '/purchase-orders' || pathname === '/deliveries' || pathname === '/receiving') return 'orders';
    const requested = routeParams.get('tab');
    return tabs.some((item) => item.value === requested) ? requested as Tab : 'overview';
  }, [pathname, routeParams]);
  const [tab, setTab] = useState<Tab>(routeTab);
  useEffect(() => setTab(routeTab), [routeTab]);
  const [search, setSearch] = useState('');
  const [selectedQuoteId, setSelectedQuoteId] = useState<number>();
  const [selectedOrderId, setSelectedOrderId] = useState<number>();
  const routeQuoteId = useMemo(() => positiveInteger(routeParams.get('quote')), [routeParams]);
  const routeOrderId = useMemo(() => positiveInteger(routeParams.get('order')), [routeParams]);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [productForm, setProductForm] = useState({ sku: '', name: '', unit: 'each', unitCost: '', listPrice: '', leadTimeDays: '0' });
  const [vendorForm, setVendorForm] = useState({ name: '', leadTimeDays: '0' });
  const [quoteForm, setQuoteForm] = useState({ customerId: '', description: '', quantity: '1', unitCost: '', unitPrice: '', promisedDate: '' });
  const [deliveryForm, setDeliveryForm] = useState({ status: 'scheduled', appointmentDate: '', carrier: '', trackingReference: '', notes: '' });
  const [deliveryQuantities, setDeliveryQuantities] = useState<Record<number, string>>({});
  const [receivingDrafts, setReceivingDrafts] = useState<Record<number, ReceivingDraft>>({});
  const [proofError, setProofError] = useState('');
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: '', totalAmount: '', dueDate: '', status: 'submitted', paidAmount: '', paymentReference: '', waiverStatus: 'not_required', waiverReference: '' });
  const [termsForm, setTermsForm] = useState({ customerId: '', paymentTerms: 'Net 30', creditLimit: '0', discountPercent: '0', retainageRequired: '0', waiverRequired: false });
  const [orderStatus, setOrderStatus] = useState<SupplierOrderStatus>('approved');

  const products = useListSupplierProducts({ search: search || undefined }, { query: { queryKey: getListSupplierProductsQueryKey({ search: search || undefined }) } });
  const vendors = useListSupplierVendors({ query: { queryKey: getListSupplierVendorsQueryKey() } });
  const customers = useListBusinessCustomers({ includeArchived: false }, { query: { queryKey: getListBusinessCustomersQueryKey({ includeArchived: false }) } });
  const terms = useListSupplierCustomerTerms({ query: { queryKey: getListSupplierCustomerTermsQueryKey() } });
  const quotes = useListSupplierQuotes(undefined, { query: { queryKey: getListSupplierQuotesQueryKey() } });
  const orders = useListSupplierOrders(undefined, { query: { queryKey: getListSupplierOrdersQueryKey() } });
  const selectedQuote = useGetSupplierQuote(selectedQuoteId ?? 0, { query: { enabled: Boolean(selectedQuoteId), queryKey: getGetSupplierQuoteQueryKey(selectedQuoteId ?? 0) } });
  const selectedOrder = useGetSupplierOrder(selectedOrderId ?? 0, { query: { enabled: Boolean(selectedOrderId), queryKey: getGetSupplierOrderQueryKey(selectedOrderId ?? 0) } });
  const events = useListSupplierOrderEvents(selectedOrderId ?? 0, { query: { enabled: Boolean(selectedOrderId), queryKey: getListSupplierOrderEventsQueryKey(selectedOrderId ?? 0) } });

  const createProduct = useCreateSupplierProduct();
  const createVendor = useCreateSupplierVendor();
  const createQuote = useCreateSupplierQuote();
  const convertQuote = useConvertSupplierQuote();
  const updateOrder = useUpdateSupplierOrder();
  const createDelivery = useCreateSupplierDelivery();
  const recordReceiving = useRecordSupplierReceiving();
  const requestProofUpload = useRequestSupplierDeliveryProofUpload();
  const completeProofUpload = useCompleteSupplierDeliveryProofUpload();
  const createInvoice = useCreateSupplierInvoice();
  const createTerms = useCreateSupplierCustomerTerms();

  useEffect(() => {
    setSelectedQuoteId(routeQuoteId);
    setSelectedOrderId(routeOrderId);
  }, [routeOrderId, routeQuoteId]);

  useEffect(() => {
    if (!selectedOrder.data) return;
    const next: Record<number, ReceivingDraft> = {};
    for (const delivery of selectedOrder.data.deliveries) {
      for (const line of delivery.lines ?? []) {
        next[line.id] = {
          received: String(line.quantityReceived),
          damaged: String(line.quantityDamaged),
          short: String(line.quantityShort),
          returned: String(line.quantityReturned),
          accepted: line.acceptedByUserId !== null,
          note: line.exceptionNote ?? '',
        };
      }
    }
    setReceivingDrafts(next);
  }, [selectedOrder.data?.id, selectedOrder.data?.updatedAt]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getListSupplierProductsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListSupplierVendorsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListSupplierQuotesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListSupplierOrdersQueryKey() });
    if (selectedOrderId) void qc.invalidateQueries({ queryKey: getGetSupplierOrderQueryKey(selectedOrderId) });
    if (selectedOrderId) void qc.invalidateQueries({ queryKey: getListSupplierOrderEventsQueryKey(selectedOrderId) });
  };

  const visibleOrders = useMemo(() => {
    const rows = orders.data ?? [];
    // The list contract intentionally returns order summaries. Use lifecycle
    // state as the queue index, then load the selected detail for delivery
    // lines and receiving dispositions.
    if (routeMode === 'deliveries') return rows.filter((order) => ['approved', 'purchasing', 'partially_fulfilled'].includes(order.orderStatus));
    if (routeMode === 'receiving') return rows.filter((order) => ['partially_fulfilled', 'fulfilled', 'closed'].includes(order.orderStatus));
    return rows;
  }, [orders.data, routeMode]);

  useEffect(() => {
    if (routeMode === 'procurement' || !visibleOrders.length) return;
    const nextOrder = routeOrderId && visibleOrders.find((order) => order.id === routeOrderId) ? visibleOrders.find((order) => order.id === routeOrderId) : visibleOrders[0];
    if (!nextOrder) return;
    if (selectedOrderId !== nextOrder.id) {
      setSelectedOrderId(nextOrder.id);
      setOrderStatus(nextOrder.orderStatus);
    }
    if (routeOrderId !== nextOrder.id) {
      const params = new URLSearchParams();
      params.set('order', String(nextOrder.id));
      setLocation(`${pathname}?${params.toString()}`, { replace: true });
    }
  }, [pathname, routeMode, routeOrderId, selectedOrderId, setLocation, visibleOrders]);

  function navigateTab(nextTab: Tab) {
    setTab(nextTab);
    if (routeMode !== 'procurement' && nextTab !== 'orders') {
      setLocation(`/procurement?tab=${nextTab}`, { replace: true });
      return;
    }
    const params = new URLSearchParams();
    if (routeMode === 'procurement' && nextTab !== 'overview') params.set('tab', nextTab);
    if (nextTab === 'quotes' && selectedQuoteId) params.set('quote', String(selectedQuoteId));
    if (nextTab === 'orders' && selectedOrderId) params.set('order', String(selectedOrderId));
    const query = params.toString();
    setLocation(`${pathname}${query ? `?${query}` : ''}`, { replace: true });
  }

  function selectQuote(id: number) {
    setSelectedQuoteId(id);
    setSelectedOrderId(undefined);
    setTab('quotes');
    setLocation(`/procurement?tab=quotes&quote=${id}`, { replace: true });
  }

  function selectOrder(id: number) {
    setSelectedOrderId(id);
    setSelectedQuoteId(undefined);
    setOrderStatus(orders.data?.find((order) => order.id === id)?.orderStatus ?? 'approved');
    const params = new URLSearchParams();
    if (routeMode === 'procurement') params.set('tab', 'orders');
    params.set('order', String(id));
    const query = params.toString();
    setLocation(`${pathname}${query ? `?${query}` : ''}`, { replace: true });
  }

  const metrics = useMemo(() => {
    const orderRows = orders.data ?? [];
    const quoteRows = quotes.data ?? [];
    return {
      openOrders: orderRows.filter((order) => !['fulfilled', 'closed', 'canceled'].includes(order.orderStatus)).length,
      awaitingDelivery: orderRows.filter((order) => ['approved', 'purchasing', 'partially_fulfilled'].includes(order.orderStatus)).length,
      openQuotes: quoteRows.filter((quote) => !['converted', 'rejected', 'expired'].includes(quote.status)).length,
      openValue: orderRows.filter((order) => !['fulfilled', 'closed', 'canceled'].includes(order.orderStatus)).reduce((sum, order) => sum + order.totalSell, 0),
    };
  }, [orders.data, quotes.data]);

  function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    createProduct.mutate({
      data: {
        sku: productForm.sku,
        name: productForm.name,
        unit: productForm.unit,
        unitCost: Number(productForm.unitCost || 0),
        listPrice: Number(productForm.listPrice || 0),
        leadTimeDays: Number(productForm.leadTimeDays || 0),
      },
    }, { onSuccess: () => { setShowProductForm(false); setProductForm({ sku: '', name: '', unit: 'each', unitCost: '', listPrice: '', leadTimeDays: '0' }); refresh(); } });
  }

  function saveVendor(event: React.FormEvent) {
    event.preventDefault();
    createVendor.mutate({ data: { name: vendorForm.name, leadTimeDays: Number(vendorForm.leadTimeDays || 0) } }, {
      onSuccess: () => { setShowVendorForm(false); setVendorForm({ name: '', leadTimeDays: '0' }); refresh(); },
    });
  }

  function saveTerms(event: React.FormEvent) {
    event.preventDefault();
    if (!termsForm.customerId) return;
    createTerms.mutate({
      data: {
        businessCustomerId: Number(termsForm.customerId),
        paymentTerms: termsForm.paymentTerms,
        creditLimit: Number(termsForm.creditLimit || 0),
        discountPercent: Number(termsForm.discountPercent || 0),
        retainageRequired: Number(termsForm.retainageRequired || 0),
        waiverRequired: termsForm.waiverRequired,
      },
    }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListSupplierCustomerTermsQueryKey() }); } });
  }

  function saveQuote(event: React.FormEvent) {
    event.preventDefault();
    if (!quoteForm.customerId) return;
    createQuote.mutate({
      data: {
        businessCustomerId: Number(quoteForm.customerId),
        lines: [{
          productId: products.data?.[0]?.id,
          vendorId: vendors.data?.[0]?.id,
          description: quoteForm.description,
          quantity: Number(quoteForm.quantity || 0),
          unit: products.data?.[0]?.unit || 'each',
          unitCost: Number(quoteForm.unitCost || 0),
          unitPrice: Number(quoteForm.unitPrice || 0),
          promisedDate: quoteForm.promisedDate || undefined,
        }],
      },
    }, { onSuccess: (quote) => { setShowQuoteForm(false); selectQuote(quote.id); refresh(); } });
  }

  function convertSelectedQuote() {
    if (!selectedQuoteId) return;
    convertQuote.mutate({ quoteId: selectedQuoteId, data: { jobsiteInstructions: 'Coordinate delivery appointment with the project team.' } }, {
      onSuccess: (order) => { selectOrder(order.id); refresh(); },
    });
  }

  function saveOrderStatus(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOrderId) return;
    updateOrder.mutate({ orderId: selectedOrderId, data: { orderStatus } }, { onSuccess: refresh });
  }

  function saveDelivery(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOrderId || !selectedOrder.data) return;
    const lines = selectedOrder.data.lines
      .map((line) => ({
        orderLineId: line.id,
        quantityDelivered: Number(deliveryQuantities[line.id] ?? Math.max(0, line.quantity - line.deliveredQuantity)),
      }))
      .filter((line) => line.quantityDelivered > 0);
    if (!lines.length) return;
    createDelivery.mutate({
      orderId: selectedOrderId,
      data: {
        status: deliveryForm.status as 'scheduled' | 'confirmed' | 'in_transit' | 'delivered' | 'partial' | 'exception' | 'returned' | 'canceled',
        appointmentDate: deliveryForm.appointmentDate || undefined,
        carrier: deliveryForm.carrier || undefined,
        trackingReference: deliveryForm.trackingReference || undefined,
        notes: deliveryForm.notes || undefined,
        lines,
      },
    }, { onSuccess: refresh });
  }

  function saveReceiving(event: React.FormEvent, delivery: SupplierDelivery) {
    event.preventDefault();
    const lines = (delivery.lines ?? []).map((line) => {
      const draft = receivingDrafts[line.id] ?? {
        received: String(line.quantityReceived),
        damaged: String(line.quantityDamaged),
        short: String(line.quantityShort),
        returned: String(line.quantityReturned),
        accepted: line.acceptedByUserId !== null,
        note: line.exceptionNote ?? '',
      };
      return {
        deliveryLineId: line.id,
        quantityReceived: Number(draft.received || 0),
        quantityDamaged: Number(draft.damaged || 0),
        quantityShort: Number(draft.short || 0),
        quantityReturned: Number(draft.returned || 0),
        accepted: draft.accepted,
        exceptionNote: draft.note || undefined,
      };
    });
    if (!selectedOrderId || !lines.length) return;
    recordReceiving.mutate({ deliveryId: delivery.id, data: { lines } }, { onSuccess: refresh });
  }

  async function uploadProof(deliveryId: number, file: File) {
    setProofError('');
    if (!allowedDeliveryProofTypes.has(file.type) || file.size > maxDeliveryProofSize) {
      setProofError('Choose a PDF, JPG, PNG, or GIF file up to 25 MB.');
      return;
    }
    try {
      const pending = await requestProofUpload.mutateAsync({
        deliveryId,
        data: { originalName: file.name, contentType: file.type, size: file.size },
      });
      const stored = await fetch(pending.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!stored.ok) throw new Error('The proof file could not be stored.');
      await completeProofUpload.mutateAsync({ deliveryId });
      refresh();
    } catch (reason) {
      setProofError(reason instanceof Error ? reason.message : 'The proof file could not be uploaded.');
    }
  }

  function saveInvoice(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOrderId) return;
    createInvoice.mutate({
      orderId: selectedOrderId,
      data: {
        invoiceNumber: invoiceForm.invoiceNumber,
        totalAmount: Number(invoiceForm.totalAmount || 0),
        dueDate: invoiceForm.dueDate || undefined,
        paidAmount: invoiceForm.paidAmount ? Number(invoiceForm.paidAmount) : undefined,
        paymentReference: invoiceForm.paymentReference || undefined,
        waiverStatus: invoiceForm.waiverStatus as 'not_required' | 'pending' | 'received' | 'approved' | 'rejected',
        waiverReference: invoiceForm.waiverReference || undefined,
        status: invoiceForm.status as 'draft' | 'submitted' | 'approved' | 'partially_paid' | 'paid' | 'disputed' | 'void',
      },
    }, { onSuccess: refresh });
  }

  const selectedProduct = products.data?.[0];
  const pageError = products.isError || vendors.isError || quotes.isError || orders.isError;

  return (
    <div className="animate-rise space-y-6">
      <PageTitle
        eyebrow={routeMode === 'procurement' ? 'Materials, purchasing, and fulfillment' : 'Supplier operations'}
        title={routeMode === 'purchase-orders' ? 'Purchase orders' : routeMode === 'deliveries' ? 'Delivery control' : routeMode === 'receiving' ? 'Receiving queue' : 'Supplier operations'}
        description={routeMode === 'purchase-orders'
          ? 'Review committed material spend, update order status, and open fulfillment details without losing customer context.'
          : routeMode === 'deliveries'
            ? 'Coordinate appointments, carriers, proof of delivery, and exceptions across every active supplier order.'
            : routeMode === 'receiving'
              ? 'Reconcile delivered quantities, damage, shortages, returns, and receiving proof before payment moves forward.'
              : 'Move supplier quotes into controlled orders, track margin and promised dates, and keep delivery, receiving, and payment history connected to the customer workspace.'}
        action={routeMode === 'procurement' ? <Button data-testid="button-new-supplier-quote" onClick={() => setShowQuoteForm((value) => !value)}><Plus size={16} /> New supplier quote</Button> : <Button variant="outline" data-testid="button-open-procurement" onClick={() => setLocation('/procurement')}>Open procurement</Button>}
      />

      <nav className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-4" aria-label="Supplier operations sections">
        {tabs.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" data-testid={`button-supplier-tab-${value}`} aria-current={tab === value ? 'page' : undefined} onClick={() => navigateTab(value)} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {pageError && <ErrorPanel title="Supplier workspace unavailable" text="The latest supplier data could not be loaded. Try again after checking the active workspace." onRetry={refresh} />}

      {tab === 'overview' && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Open orders" value={String(metrics.openOrders)} detail="Not fulfilled or closed" icon={ClipboardList} accent="teal" />
            <StatCard label="Awaiting delivery" value={String(metrics.awaitingDelivery)} detail="Purchasing and partial fulfillment" icon={Truck} accent="orange" />
            <StatCard label="Open quotes" value={String(metrics.openQuotes)} detail="Awaiting decision or conversion" icon={Receipt} accent="violet" />
            <StatCard label="Open sell value" value={money(metrics.openValue)} detail="Margin visible to the team" icon={Warehouse} accent="green" />
          </section>
          <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
            <Section eyebrow="Order book" title="Latest supplier orders" action={<Button variant="ghost" onClick={() => navigateTab('orders')}>View all <ArrowRight size={15} /></Button>}>
              {orders.isLoading ? <LoadingPanel lines={4} /> : orders.data?.length ? <OrderTable orders={orders.data.slice(0, 5)} selectedOrderId={selectedOrderId} onSelect={selectOrder} /> : <EmptyState icon={Truck} title="No supplier orders yet" text="Accept a supplier quote to create the first purchase order." />}
            </Section>
            <Section eyebrow="Supply readiness" title="Catalog signals">
              <div className="space-y-3">
                <Signal label="Products in catalog" value={products.data?.length ?? 0} detail="Materials and units ready to quote" />
                <Signal label="Active vendors" value={vendors.data?.filter((vendor) => vendor.status === 'active').length ?? 0} detail="Supplier relationships in this environment" />
                <Signal label="Backordered units" value={(products.data ?? []).reduce((sum, product) => sum + product.backorderedQuantity, 0)} detail="Catalog availability needs attention" />
              </div>
            </Section>
          </div>
        </>
      )}

      {tab === 'catalog' && (
        <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
          <Section
            eyebrow="Catalog & pricing"
            title="Products and materials"
            action={<Button onClick={() => setShowProductForm((value) => !value)}><Plus size={15} /> Add product</Button>}
          >
            <div className="mb-4 flex items-center gap-2">
              <Search size={16} className="text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SKU, product, or category" className={inputClass} />
            </div>
            {showProductForm && <form onSubmit={saveProduct} className="mb-4 grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:grid-cols-2">
              <Field label="SKU"><Input required value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} className={inputClass} /></Field>
              <Field label="Product name"><Input required value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} className={inputClass} /></Field>
              <Field label="Unit"><Input value={productForm.unit} onChange={(event) => setProductForm({ ...productForm, unit: event.target.value })} className={inputClass} /></Field>
              <Field label="Lead time (days)"><Input type="number" min="0" value={productForm.leadTimeDays} onChange={(event) => setProductForm({ ...productForm, leadTimeDays: event.target.value })} className={inputClass} /></Field>
              <Field label="Unit cost"><Input required type="number" min="0" step="0.01" value={productForm.unitCost} onChange={(event) => setProductForm({ ...productForm, unitCost: event.target.value })} className={inputClass} /></Field>
              <Field label="List price"><Input required type="number" min="0" step="0.01" value={productForm.listPrice} onChange={(event) => setProductForm({ ...productForm, listPrice: event.target.value })} className={inputClass} /></Field>
              <div className="flex gap-2 sm:col-span-2"><Button type="submit">Save product</Button><Button type="button" variant="ghost" onClick={() => setShowProductForm(false)}>Cancel</Button></div>
            </form>}
            {products.isLoading ? <LoadingPanel lines={5} /> : products.data?.length ? <ProductTable products={products.data} /> : <EmptyState icon={Package} title="No products yet" text="Add materials with unit cost, sell price, lead time, and availability." />}
          </Section>
          <Section eyebrow="Vendor directory" title="Supplier vendors" action={<Button onClick={() => setShowVendorForm((value) => !value)}><Plus size={15} /> Add vendor</Button>}>
            {showVendorForm && <form onSubmit={saveVendor} className="mb-4 grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <Field label="Vendor name"><Input required value={vendorForm.name} onChange={(event) => setVendorForm({ ...vendorForm, name: event.target.value })} className={inputClass} /></Field>
              <Field label="Typical lead time (days)"><Input type="number" min="0" value={vendorForm.leadTimeDays} onChange={(event) => setVendorForm({ ...vendorForm, leadTimeDays: event.target.value })} className={inputClass} /></Field>
              <div className="flex gap-2"><Button type="submit">Save vendor</Button><Button type="button" variant="ghost" onClick={() => setShowVendorForm(false)}>Cancel</Button></div>
            </form>}
            {vendors.data?.length ? <div className="space-y-2">{vendors.data.map((vendor) => <div key={vendor.id} className="flex items-center justify-between rounded-lg border border-border p-3"><div><p className="text-sm font-bold">{vendor.name}</p><p className="mono mt-1 text-[9px] uppercase tracking-[.08em] text-muted-foreground">{vendor.leadTimeDays} day lead time</p></div><Badge tone={statusTone(vendor.status)}>{vendor.status}</Badge></div>)}</div> : <EmptyState icon={Warehouse} title="No vendors yet" text="Add the supplier relationships that will support quoting and purchasing." />}
          </Section>
           <Section eyebrow="Account controls" title="Customer terms">
             <form onSubmit={saveTerms} className="grid gap-3">
               <Field label="Customer"><select required value={termsForm.customerId} onChange={(event) => {
                 const customerId = event.target.value;
                 const existing = terms.data?.find((term) => term.businessCustomerId === Number(customerId));
                 setTermsForm({
                   customerId,
                   paymentTerms: existing?.paymentTerms ?? 'Net 30',
                   creditLimit: String(existing?.creditLimit ?? 0),
                   discountPercent: String(existing?.discountPercent ?? 0),
                   retainageRequired: String(existing?.retainageRequired ?? 0),
                   waiverRequired: existing?.waiverRequired ?? false,
                 });
               }} className={inputClass}><option value="">Choose customer</option>{customers.data?.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></Field>
               <div className="grid gap-3 sm:grid-cols-2">
                 <Field label="Payment terms"><Input value={termsForm.paymentTerms} onChange={(event) => setTermsForm({ ...termsForm, paymentTerms: event.target.value })} className={inputClass} /></Field>
                 <Field label="Retainage required (%)"><Input type="number" min="0" max="100" step="0.01" value={termsForm.retainageRequired} onChange={(event) => setTermsForm({ ...termsForm, retainageRequired: event.target.value })} className={inputClass} /></Field>
                 <Field label="Credit limit"><Input type="number" min="0" step="0.01" value={termsForm.creditLimit} onChange={(event) => setTermsForm({ ...termsForm, creditLimit: event.target.value })} className={inputClass} /></Field>
                 <Field label="Discount (%)"><Input type="number" min="0" max="100" step="0.01" value={termsForm.discountPercent} onChange={(event) => setTermsForm({ ...termsForm, discountPercent: event.target.value })} className={inputClass} /></Field>
               </div>
               <label className="flex items-start gap-2 rounded-lg border border-border/70 p-3 text-xs"><input type="checkbox" checked={termsForm.waiverRequired} onChange={(event) => setTermsForm({ ...termsForm, waiverRequired: event.target.checked })} className="mt-0.5" /><span><span className="block font-semibold text-foreground">Require waiver before payment or closeout</span><span className="mt-1 block text-muted-foreground">Invoices remain blocked until the waiver is received or approved.</span></span></label>
               <Button type="submit" disabled={!termsForm.customerId || createTerms.isPending}>{createTerms.isPending ? 'Saving…' : 'Save customer terms'}</Button>
               {createTerms.isError && <p role="alert" className="text-xs text-destructive">Customer terms could not be saved.</p>}
             </form>
           </Section>
        </div>
      )}

      {tab === 'quotes' && (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
          <Section eyebrow="Supplier pricing" title="Quotes and proposals" action={<Button onClick={() => setShowQuoteForm((value) => !value)}><Plus size={15} /> New quote</Button>}>
            {showQuoteForm && <form onSubmit={saveQuote} className="mb-4 grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:grid-cols-2">
              <Field label="Customer"><select required value={quoteForm.customerId} onChange={(event) => setQuoteForm({ ...quoteForm, customerId: event.target.value })} className={inputClass}><option value="">Choose customer</option>{customers.data?.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></Field>
              <Field label="Description"><Input required value={quoteForm.description} onChange={(event) => setQuoteForm({ ...quoteForm, description: event.target.value })} placeholder={selectedProduct?.name || 'Material scope'} className={inputClass} /></Field>
              <Field label="Quantity"><Input required type="number" min="0.001" step="0.001" value={quoteForm.quantity} onChange={(event) => setQuoteForm({ ...quoteForm, quantity: event.target.value })} className={inputClass} /></Field>
              <Field label="Promised date"><Input type="date" value={quoteForm.promisedDate} onChange={(event) => setQuoteForm({ ...quoteForm, promisedDate: event.target.value })} className={inputClass} /></Field>
              <Field label="Unit cost"><Input required type="number" min="0" step="0.01" value={quoteForm.unitCost} onChange={(event) => setQuoteForm({ ...quoteForm, unitCost: event.target.value })} className={inputClass} /></Field>
              <Field label="Unit sell price"><Input required type="number" min="0" step="0.01" value={quoteForm.unitPrice} onChange={(event) => setQuoteForm({ ...quoteForm, unitPrice: event.target.value })} className={inputClass} /></Field>
              <div className="flex gap-2 sm:col-span-2"><Button type="submit">Create quote</Button><Button type="button" variant="ghost" onClick={() => setShowQuoteForm(false)}>Cancel</Button></div>
            </form>}
            {quotes.isLoading ? <LoadingPanel lines={5} /> : quotes.data?.length ? <QuoteTable quotes={quotes.data} selectedQuoteId={selectedQuoteId} onSelect={selectQuote} /> : <EmptyState icon={Receipt} title="No supplier quotes yet" text="Create a quote from catalog pricing, then convert accepted work into an order." />}
          </Section>
          <Section eyebrow="Conversion" title="Quote detail">
            {!selectedQuoteId ? <EmptyState icon={Receipt} title="Choose a quote" text="Select a quote to review margin and convert accepted supplier pricing into an order." /> : selectedQuote.isLoading ? <LoadingPanel lines={4} /> : selectedQuote.data ? <div className="space-y-4">
              <div className="flex items-start justify-between gap-3"><div><p className="mono text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">{selectedQuote.data.quoteNumber}</p><h3 className="mt-1 text-base font-bold">{selectedQuote.data.customerName}</h3></div><Badge tone={statusTone(selectedQuote.data.status)}>{labelStatus(selectedQuote.data.status)}</Badge></div>
              <div className="grid grid-cols-3 gap-2"><Metric label="Sell" value={money(selectedQuote.data.totalSell)} /><Metric label="Cost" value={money(selectedQuote.data.totalCost)} /><Metric label="Margin" value={money(selectedQuote.data.grossMargin)} /></div>
              <div className="space-y-2">{selectedQuote.data.lines.map((line) => <div key={line.id} className="rounded-lg border border-border p-3"><div className="flex justify-between gap-2 text-sm"><span className="font-semibold">{line.description}</span><span>{line.quantity} {line.unit}</span></div><p className="mono mt-1 text-[9px] uppercase tracking-[.08em] text-muted-foreground">{money(line.unitCost)} cost · {money(line.unitPrice)} sell{line.promisedDate ? ` · ${shortDate(line.promisedDate)}` : ''}</p></div>)}</div>
              {selectedQuote.data.status === 'accepted' && <Button onClick={convertSelectedQuote} disabled={convertQuote.isPending}>Convert to purchase order <ArrowRight size={15} /></Button>}
              {convertQuote.isError && <p role="alert" className="text-xs text-destructive">This quote could not be converted. It may already have an order or is not accepted.</p>}
            </div> : <EmptyState icon={Receipt} title="Quote not found" text="Refresh the workspace and choose another quote." />}
          </Section>
        </div>
      )}

      {tab === 'orders' && (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
          <Section
            eyebrow={routeMode === 'deliveries' ? 'Appointments and tracking' : routeMode === 'receiving' ? 'Delivered quantities and exceptions' : 'Purchasing and fulfillment'}
            title={routeMode === 'deliveries' ? 'Delivery schedule' : routeMode === 'receiving' ? 'Receiving dispositions' : 'Supplier orders'}
          >
            {orders.isLoading ? <LoadingPanel lines={5} /> : visibleOrders.length ? <OrderTable orders={visibleOrders} selectedOrderId={selectedOrderId} onSelect={selectOrder} /> : <EmptyState icon={routeMode === 'receiving' ? Warehouse : Truck} title={routeMode === 'receiving' ? 'No receiving work yet' : routeMode === 'deliveries' ? 'No deliveries scheduled' : 'No orders yet'} text={routeMode === 'receiving' ? 'Delivered, partial, and exception quantities will appear here for disposition.' : routeMode === 'deliveries' ? 'Create a delivery from a purchase order to begin scheduling and tracking fulfillment.' : 'Accepted supplier quotes appear here as purchase orders.'} />}
          </Section>
          <Section eyebrow="Fulfillment control" title="Order detail">
            {!selectedOrderId ? <EmptyState icon={ClipboardList} title="Choose an order" text="Review promised dates, margin, delivery appointments, receiving, invoices, and audit events." /> : selectedOrder.isLoading ? <LoadingPanel lines={5} /> : selectedOrder.data ? <div className="space-y-5">
              <div className="flex items-start justify-between gap-3"><div><p className="mono text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">{selectedOrder.data.orderNumber}</p><h3 className="mt-1 text-base font-bold">{selectedOrder.data.customerName}</h3><p className="mt-1 text-xs text-muted-foreground">{selectedOrder.data.jobsiteInstructions || 'No jobsite instructions shared yet.'}</p></div><Badge tone={statusTone(selectedOrder.data.orderStatus)}>{labelStatus(selectedOrder.data.orderStatus)}</Badge></div>
              <div className="grid grid-cols-3 gap-2"><Metric label="Sell" value={money(selectedOrder.data.totalSell)} /><Metric label="Cost" value={money(selectedOrder.data.totalCost)} /><Metric label="Margin" value={money(selectedOrder.data.grossMargin)} /></div>
              <div className="space-y-2">{selectedOrder.data.lines.map((line) => <div key={line.id} className="rounded-lg border border-border p-3"><div className="flex justify-between gap-2 text-sm"><span className="font-semibold">{line.description}</span><span>{line.receivedQuantity}/{line.quantity} received</span></div><div className="mt-2 flex flex-wrap gap-1.5"><Badge tone={line.backorderedQuantity > 0 ? 'orange' : 'green'}>{line.backorderedQuantity > 0 ? `${line.backorderedQuantity} backordered` : 'fully purchased'}</Badge>{line.approvedSubstitution && <Badge tone="teal">substitution approved</Badge>}</div></div>)}</div>
              <form onSubmit={saveOrderStatus} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-end"><Field label="Order status"><select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value as SupplierOrderStatus)} className={inputClass}>{['draft', 'pending_approval', 'approved', 'purchasing', 'partially_fulfilled', 'fulfilled', 'closed', 'canceled'].map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></Field><Button type="submit" disabled={updateOrder.isPending}>Save status</Button></form>
               <form onSubmit={saveDelivery} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
                 <p className="mono text-[9px] font-bold uppercase tracking-[.12em] text-primary sm:col-span-2">Schedule delivery / partial fulfillment</p>
                 {selectedOrder.data.lines.map((line) => <Field key={line.id} label={`Quantity delivered · ${line.description}`}><Input type="number" min="0" max={Math.max(0, line.quantity - line.deliveredQuantity)} step="0.001" value={deliveryQuantities[line.id] ?? String(Math.max(0, line.quantity - line.deliveredQuantity))} onChange={(event) => setDeliveryQuantities({ ...deliveryQuantities, [line.id]: event.target.value })} className={inputClass} /></Field>)}
                 <Field label="Status"><select value={deliveryForm.status} onChange={(event) => setDeliveryForm({ ...deliveryForm, status: event.target.value })} className={inputClass}>{['scheduled', 'confirmed', 'in_transit', 'delivered', 'partial', 'exception', 'returned'].map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></Field>
                 <Field label="Appointment date"><Input type="date" value={deliveryForm.appointmentDate} onChange={(event) => setDeliveryForm({ ...deliveryForm, appointmentDate: event.target.value })} className={inputClass} /></Field>
                 <Field label="Carrier / reference"><Input value={deliveryForm.carrier} onChange={(event) => setDeliveryForm({ ...deliveryForm, carrier: event.target.value })} className={inputClass} /></Field>
                 <div className="sm:col-span-2"><Button type="submit" disabled={createDelivery.isPending}>{createDelivery.isPending ? 'Recording…' : 'Record delivery'}</Button></div>
               </form>
                <section className="space-y-3">
                  <div><p className="mono text-[9px] font-bold uppercase tracking-[.12em] text-primary">{routeMode === 'deliveries' ? 'Delivery evidence' : 'Receiving closeout'}</p><h4 className="mt-1 text-sm font-bold">{routeMode === 'deliveries' ? 'Proof, appointments, and exceptions' : 'Proof, exceptions, and returns'}</h4><p className="mt-1 text-xs text-muted-foreground">{routeMode === 'deliveries' ? 'Keep appointment status, proof, and exceptions attached to the order as fulfillment moves.' : 'Record the final quantity disposition for every delivery line. Order received totals are recalculated from these entries.'}</p></div>
                 {selectedOrder.data.deliveries.length ? selectedOrder.data.deliveries.map((delivery) => <DeliveryReceivingCard key={delivery.id} delivery={delivery} orderLines={selectedOrder.data!.lines} drafts={receivingDrafts} onDraftChange={(lineId, draft) => setReceivingDrafts((current) => ({ ...current, [lineId]: draft }))} onSave={saveReceiving} onUpload={uploadProof} proofError={proofError} isSaving={recordReceiving.isPending} isUploading={requestProofUpload.isPending || completeProofUpload.isPending} />) : <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">Record a delivery above to start receiving.</div>}
               </section>
              <form onSubmit={saveInvoice} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"><p className="mono text-[9px] font-bold uppercase tracking-[.12em] text-primary sm:col-span-2">Supplier invoice</p><Field label="Invoice number"><Input required value={invoiceForm.invoiceNumber} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoiceNumber: event.target.value })} className={inputClass} /></Field><Field label="Total amount"><Input required type="number" min="0" step="0.01" value={invoiceForm.totalAmount} onChange={(event) => setInvoiceForm({ ...invoiceForm, totalAmount: event.target.value })} className={inputClass} /></Field><Field label="Due date"><Input type="date" value={invoiceForm.dueDate} onChange={(event) => setInvoiceForm({ ...invoiceForm, dueDate: event.target.value })} className={inputClass} /></Field><Field label="Payment status"><select value={invoiceForm.status} onChange={(event) => setInvoiceForm({ ...invoiceForm, status: event.target.value })} className={inputClass}>{['submitted', 'approved', 'partially_paid', 'paid', 'disputed'].map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></Field><Field label="Amount paid"><Input type="number" min="0" step="0.01" value={invoiceForm.paidAmount} onChange={(event) => setInvoiceForm({ ...invoiceForm, paidAmount: event.target.value })} className={inputClass} /></Field><Field label="Payment reference"><Input value={invoiceForm.paymentReference} onChange={(event) => setInvoiceForm({ ...invoiceForm, paymentReference: event.target.value })} placeholder="Check, ACH, or remittance reference" className={inputClass} /></Field><Field label="Waiver status"><select value={invoiceForm.waiverStatus} onChange={(event) => setInvoiceForm({ ...invoiceForm, waiverStatus: event.target.value })} className={inputClass}>{['not_required', 'pending', 'received', 'approved', 'rejected'].map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></Field><Field label="Waiver reference"><Input value={invoiceForm.waiverReference} onChange={(event) => setInvoiceForm({ ...invoiceForm, waiverReference: event.target.value })} className={inputClass} /></Field><div className="sm:col-span-2"><Button type="submit" disabled={createInvoice.isPending}>Add invoice</Button></div></form>
              {selectedOrder.data.invoices.length > 0 && <div><p className="mb-2 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Invoices</p><div className="space-y-2">{selectedOrder.data.invoices.map((invoice) => <div key={invoice.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"><span className="font-semibold">{invoice.invoiceNumber}</span><span>{money(invoice.totalAmount)} <Badge tone={statusTone(invoice.status)}>{labelStatus(invoice.status)}</Badge></span></div>)}</div></div>}
              {events.data?.length ? <div><p className="mb-2 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Audit history</p><div className="space-y-2">{events.data.slice(0, 6).map((event) => <div key={event.id} className="flex gap-3 rounded-lg border border-border p-3 text-xs"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" /><div><p className="font-semibold">{labelStatus(event.action)}</p><p className="text-muted-foreground">{event.details || `${event.fromStatus || '—'} → ${event.toStatus || '—'}`} · {shortDate(event.createdAt.toString())}</p></div></div>)}</div></div> : null}
            </div> : <EmptyState icon={ClipboardList} title="Order not found" text="Refresh the workspace and choose another order." />}
          </Section>
        </div>
      )}
    </div>
  );
}

function DeliveryReceivingCard({
  delivery,
  orderLines,
  drafts,
  onDraftChange,
  onSave,
  onUpload,
  proofError,
  isSaving,
  isUploading,
}: {
  delivery: SupplierDelivery;
  orderLines: SupplierOrderLine[];
  drafts: Record<number, ReceivingDraft>;
  onDraftChange: (lineId: number, draft: ReceivingDraft) => void;
  onSave: (event: React.FormEvent, delivery: SupplierDelivery) => void;
  onUpload: (deliveryId: number, file: File) => void;
  proofError: string;
  isSaving: boolean;
  isUploading: boolean;
}) {
  const lines = delivery.lines ?? [];
  return (
    <form onSubmit={(event) => onSave(event, delivery)} className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mono text-[10px] font-bold uppercase tracking-[.1em]">{delivery.deliveryNumber}</p>
            <Badge tone={statusTone(delivery.status)}>{labelStatus(delivery.status)}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{delivery.carrier || 'Carrier not recorded'}{delivery.trackingReference ? ` · ${delivery.trackingReference}` : ''}{delivery.deliveredAt ? ` · ${shortDate(delivery.deliveredAt)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {delivery.proofFileName ? <button type="button" className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:underline" onClick={() => window.open(getGetSupplierDeliveryProofUrl(delivery.id), '_blank', 'noopener,noreferrer')}><CheckCircle2 size={13} /> View proof</button> : <label className={`inline-flex cursor-pointer items-center gap-1 text-[10px] font-bold text-primary hover:underline ${isUploading ? 'pointer-events-none opacity-50' : ''}`}><Upload size={13} /> {isUploading ? 'Uploading…' : 'Add proof'}<input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.gif" disabled={isUploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(delivery.id, file); event.currentTarget.value = ''; }} /></label>}
        </div>
      </div>
      {proofError && <p role="alert" className="mt-2 text-xs text-destructive">{proofError}</p>}
      {lines.length ? <div className="mt-3 space-y-3">
        {lines.map((line) => {
          const orderLine = orderLines.find((candidate) => candidate.id === line.orderLineId);
          const draft = drafts[line.id] ?? {
            received: String(line.quantityReceived),
            damaged: String(line.quantityDamaged),
            short: String(line.quantityShort),
            returned: String(line.quantityReturned),
            accepted: line.acceptedByUserId !== null,
            note: line.exceptionNote ?? '',
          };
          const accounted = Number(draft.received || 0) + Number(draft.damaged || 0) + Number(draft.short || 0) + Number(draft.returned || 0);
          return <div key={line.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-semibold">{orderLine?.description || `Order line ${line.orderLineId}`}</p><p className="mono mt-1 text-[9px] uppercase tracking-[.08em] text-muted-foreground">{accounted} / {line.quantityDelivered} accounted for</p></div>
              {accounted > line.quantityDelivered && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive"><AlertTriangle size={12} /> Over delivery</span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Accepted"><Input type="number" min="0" max={line.quantityDelivered} step="0.001" value={draft.received} onChange={(event) => onDraftChange(line.id, { ...draft, received: event.target.value })} className={inputClass} /></Field>
              <Field label="Damaged"><Input type="number" min="0" max={line.quantityDelivered} step="0.001" value={draft.damaged} onChange={(event) => onDraftChange(line.id, { ...draft, damaged: event.target.value })} className={inputClass} /></Field>
              <Field label="Short"><Input type="number" min="0" max={line.quantityDelivered} step="0.001" value={draft.short} onChange={(event) => onDraftChange(line.id, { ...draft, short: event.target.value })} className={inputClass} /></Field>
              <Field label="Returned"><Input type="number" min="0" max={line.quantityDelivered} step="0.001" value={draft.returned} onChange={(event) => onDraftChange(line.id, { ...draft, returned: event.target.value })} className={inputClass} /></Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><input type="checkbox" checked={draft.accepted} onChange={(event) => onDraftChange(line.id, { ...draft, accepted: event.target.checked })} /> Accept this line for receiving</label>
            <Input value={draft.note} onChange={(event) => onDraftChange(line.id, { ...draft, note: event.target.value })} placeholder="Exception note for damage, shortage, or return" className={`mt-3 ${inputClass}`} />
          </div>;
        })}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {delivery.status === 'exception' || delivery.status === 'returned' ? <p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><RotateCcw size={13} /> Review the exception before closing the order.</p> : <span />}
          <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving receiving…' : 'Save receiving'}</Button>
        </div>
      </div> : <p className="mt-3 text-xs text-muted-foreground">This delivery has no receiving lines.</p>}
    </form>
  );
}

function Signal({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><span className="mono text-lg font-bold text-primary">{value}</span></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-secondary/60 p-2.5"><p className="mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-bold">{value}</p></div>;
}

function ProductTable({ products }: { products: SupplierProduct[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="pb-2 font-semibold">Product</th><th className="pb-2 font-semibold">Unit</th><th className="pb-2 font-semibold">Cost / sell</th><th className="pb-2 font-semibold">Availability</th><th className="pb-2 font-semibold">Lead</th></tr></thead><tbody className="divide-y divide-border">{products.map((product) => <tr key={product.id}><td className="py-3"><p className="font-bold">{product.name}</p><p className="mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">{product.sku}</p></td><td className="py-3">{product.unit}</td><td className="py-3">{money(product.unitCost)} / {money(product.listPrice)}</td><td className="py-3"><Badge tone={product.backorderedQuantity > 0 ? 'orange' : 'green'}>{product.backorderedQuantity > 0 ? `${product.backorderedQuantity} backordered` : `${product.availableQuantity} available`}</Badge></td><td className="py-3">{product.leadTimeDays}d</td></tr>)}</tbody></table></div>;
}

function QuoteTable({ quotes, selectedQuoteId, onSelect }: { quotes: SupplierQuote[]; selectedQuoteId?: number; onSelect: (id: number) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="pb-2 font-semibold">Quote</th><th className="pb-2 font-semibold">Customer</th><th className="pb-2 font-semibold">Sell</th><th className="pb-2 font-semibold">Margin</th><th className="pb-2 font-semibold">Status</th></tr></thead><tbody className="divide-y divide-border">{quotes.map((quote) => <tr key={quote.id} data-testid={`row-supplier-quote-${quote.id}`} tabIndex={0} role="button" className={`cursor-pointer transition-colors hover:bg-secondary/50 ${selectedQuoteId === quote.id ? 'bg-primary/5' : ''}`} onClick={() => onSelect(quote.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(quote.id); }}><td className="py-3 font-bold">{quote.quoteNumber}</td><td className="py-3">{quote.customerName}</td><td className="py-3">{money(quote.totalSell)}</td><td className="py-3">{money(quote.grossMargin)}</td><td className="py-3"><Badge tone={statusTone(quote.status)}>{labelStatus(quote.status)}</Badge></td></tr>)}</tbody></table></div>;
}

function OrderTable({ orders, selectedOrderId, onSelect }: { orders: SupplierOrder[]; selectedOrderId?: number; onSelect: (id: number) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="pb-2 font-semibold">Order</th><th className="pb-2 font-semibold">Customer</th><th className="pb-2 font-semibold">Promised</th><th className="pb-2 font-semibold">Sell / margin</th><th className="pb-2 font-semibold">Status</th></tr></thead><tbody className="divide-y divide-border">{orders.map((order) => <tr key={order.id} data-testid={`row-supplier-order-${order.id}`} tabIndex={0} role="button" className={`cursor-pointer transition-colors hover:bg-secondary/50 ${selectedOrderId === order.id ? 'bg-primary/5' : ''}`} onClick={() => onSelect(order.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(order.id); }}><td className="py-3 font-bold">{order.orderNumber}</td><td className="py-3">{order.customerName}</td><td className="py-3">{shortDate(order.promisedDate)}</td><td className="py-3">{money(order.totalSell)} <span className="text-muted-foreground">/ {money(order.grossMargin)}</span></td><td className="py-3"><Badge tone={statusTone(order.orderStatus)}>{labelStatus(order.orderStatus)}</Badge></td></tr>)}</tbody></table></div>;
}