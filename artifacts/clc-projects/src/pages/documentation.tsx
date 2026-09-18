import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Download, ExternalLink, FileArchive, FileCheck2, FileText, FolderOpen, Search, ShieldCheck } from 'lucide-react';
import {
  type SubmittalDocument,
  type SubmittalItem,
  type SubmittalPackage,
  useListSubmittalPackages,
  getListSubmittalPackagesQueryKey,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle, StatCard, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

type DocumentRow = {
  id: string;
  projectId: number;
  projectNumber: string;
  projectName: string;
  customerName: string;
  packageId: number;
  packageNumber: string;
  packageName: string;
  itemId: number;
  itemNumber: string;
  itemName: string;
  itemType: string;
  itemStatus: string;
  name: string;
  href: string;
  kind: 'uploaded' | 'reference';
  size: number | null;
  pageCount: number | null;
  scanStatus: string | null;
  uploadedAt: string | null;
  updatedAt: string;
};

const documentTypes = [
  { value: 'all', label: 'All document types' },
  { value: 'closeout', label: 'Closeout' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'other', label: 'Other documentation' },
];

const itemTypeLabel = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const itemStatusTone = (value: string) => value === 'accepted' || value === 'included' ? 'green' as const : value === 'needs_revision' ? 'red' as const : value === 'pending' ? 'orange' as const : 'neutral' as const;
const scanTone = (value: string | null) => value === 'clean' ? 'green' as const : value === 'infected' || value === 'unavailable' || value === 'timeout' ? 'red' as const : 'orange' as const;

function formatBytes(value: number | null) {
  if (!value) return 'Reference link';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getDocumentRows(packages: SubmittalPackage[]) {
  return packages.flatMap((pkg) => pkg.items.flatMap((item: SubmittalItem) => {
    const rows: DocumentRow[] = [];
    if (item.documentName && item.documentUrl) {
      rows.push({
        id: `reference-${item.id}`,
        projectId: pkg.projectId,
        projectNumber: pkg.projectNumber,
        projectName: pkg.projectName,
        customerName: pkg.customerName,
        packageId: pkg.id,
        packageNumber: pkg.packageNumber,
        packageName: pkg.name,
        itemId: item.id,
        itemNumber: item.itemNumber,
        itemName: item.name,
        itemType: item.itemType,
        itemStatus: item.status,
        name: item.documentName,
        href: item.documentUrl,
        kind: 'reference',
        size: null,
        pageCount: null,
        scanStatus: null,
        uploadedAt: null,
        updatedAt: item.updatedAt,
      });
    }
    item.documents.forEach((document: SubmittalDocument) => {
      rows.push({
        id: `upload-${document.id}`,
        projectId: pkg.projectId,
        projectNumber: pkg.projectNumber,
        projectName: pkg.projectName,
        customerName: pkg.customerName,
        packageId: pkg.id,
        packageNumber: pkg.packageNumber,
        packageName: pkg.name,
        itemId: item.id,
        itemNumber: item.itemNumber,
        itemName: item.name,
        itemType: item.itemType,
        itemStatus: item.status,
        name: document.originalName,
        href: document.downloadUrl,
        kind: 'uploaded',
        size: document.size,
        pageCount: document.pageCount,
        scanStatus: document.scanStatus,
        uploadedAt: document.uploadedAt,
        updatedAt: document.createdAt,
      });
    });
    return rows;
  }));
}

function DocumentCard({ row }: { row: DocumentRow }) {
  return (
    <article data-testid={`documentation-card-${row.id}`} className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {row.kind === 'uploaded' ? <Download size={16} /> : <ExternalLink size={16} />}
          </span>
          <div className="min-w-0">
            <a href={row.href} target="_blank" rel="noreferrer" className="block truncate text-sm font-bold text-primary hover:underline">{row.name}</a>
            <p className="mt-1 truncate text-xs text-muted-foreground">{row.itemName} · {itemTypeLabel(row.itemType)}</p>
          </div>
        </div>
        <Badge tone={itemStatusTone(row.itemStatus)}>{itemTypeLabel(row.itemStatus)}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Project</p><Link href={`/projects/${row.projectId}`} className="font-semibold text-primary hover:underline">{row.projectNumber}</Link><p className="truncate text-muted-foreground">{row.projectName}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Package</p><Link href={`/submittals/${row.packageId}`} className="font-semibold text-primary hover:underline">{row.packageNumber}</Link><p className="truncate text-muted-foreground">{row.packageName}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">File</p><p>{formatBytes(row.size)}{row.pageCount ? ` · ${row.pageCount} pages` : ''}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Added</p><p>{shortDate(row.uploadedAt ?? row.updatedAt)}</p></div>
      </div>
      {row.scanStatus && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} className={scanTone(row.scanStatus) === 'green' ? 'text-status-success' : 'text-status-warning'} /> {row.scanStatus === 'clean' ? 'Security scan passed' : itemTypeLabel(row.scanStatus)}</p>}
    </article>
  );
}

export function Documentation() {
  useRouteMetadata(routeMetadata.documentation);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const query = useListSubmittalPackages(undefined, { query: { queryKey: getListSubmittalPackagesQueryKey(), staleTime: 30000 } });
  const packages = query.data ?? [];
  const allRows = useMemo(() => getDocumentRows(packages), [packages]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((row) => {
      const haystack = [row.name, row.projectNumber, row.projectName, row.customerName, row.packageNumber, row.packageName, row.itemName].join(' ').toLowerCase();
      return (!needle || haystack.includes(needle))
        && (typeFilter === 'all' || row.itemType === typeFilter)
        && (statusFilter === 'all' || row.itemStatus === statusFilter);
    });
  }, [allRows, search, statusFilter, typeFilter]);
  const reviewCount = allRows.filter((row) => row.itemStatus === 'pending' || row.itemStatus === 'needs_revision' || (row.scanStatus && row.scanStatus !== 'clean')).length;
  const closeoutCount = allRows.filter((row) => ['closeout', 'warranty', 'certificate'].includes(row.itemType)).length;

  return (
    <div className="animate-rise space-y-6">
      <PageTitle eyebrow="Closeout workspace" title="Documentation" description="Keep warranties, certificates, closeout records, and project files easy to find after the work is complete." action={<Link href="/submittals" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><FileText size={15} /> Manage submittals</Link>} />
      <section data-testid="documentation-summary-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Visible documents" value={query.isLoading ? '—' : String(allRows.length)} detail="Files and linked references" icon={FileArchive} accent="teal" />
        <StatCard label="Closeout records" value={query.isLoading ? '—' : String(closeoutCount)} detail="Warranties, certificates, closeout" icon={FileCheck2} accent="green" />
        <StatCard label="Needs review" value={query.isLoading ? '—' : String(reviewCount)} detail="Items or scans needing attention" icon={ShieldCheck} accent="orange" />
        <StatCard label="Projects represented" value={query.isLoading ? '—' : String(new Set(allRows.map((row) => row.projectId)).size)} detail="Across this workspace" icon={FolderOpen} accent="violet" />
      </section>
      <section className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input data-testid="input-documentation-search" aria-label="Search documentation" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search file, project, customer, package, or item" className="h-10 border-transparent bg-secondary/65 pl-9" /></label>
          <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger data-testid="select-documentation-type" aria-label="Filter documentation by type" className="h-10 border-transparent bg-secondary/65 md:w-52"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{documentTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger data-testid="select-documentation-status" aria-label="Filter documentation by status" className="h-10 border-transparent bg-secondary/65 md:w-44"><SelectValue /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All review statuses</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="included">Included</SelectItem><SelectItem value="accepted">Accepted</SelectItem><SelectItem value="needs_revision">Needs revision</SelectItem><SelectItem value="superseded">Superseded</SelectItem></SelectContent></Select>
          {(search || typeFilter !== 'all' || statusFilter !== 'all') && <Button variant="ghost" onClick={() => { setSearch(''); setTypeFilter('all'); setStatusFilter('all'); }}>Clear</Button>}
        </div>
      </section>
      {query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel title="Documentation unavailable" text="The documentation library could not load project files." onRetry={() => { void query.refetch(); }} /> : !rows.length ? <EmptyState icon={FileArchive} title={allRows.length ? 'No documents match this view' : 'No project documents yet'} text={allRows.length ? 'Try a different search or clear the filters.' : 'Add closeout, warranty, or certificate documentation to a submittal item to see it here.'} action={!allRows.length ? <Link href="/submittals" className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><FileText size={15} /> Open submittals</Link> : undefined} /> : <><div className="space-y-3 md:hidden">{rows.map((row) => <DocumentCard key={row.id} row={row} />)}</div><div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="border-b border-border bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Document</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Package / item</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Review</th><th className="px-4 py-3">Added</th><th className="px-4 py-3 text-right">Open</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} data-testid={`documentation-row-${row.id}`} className="border-b border-border/70 last:border-0 hover:bg-secondary/35"><td className="max-w-64 px-4 py-3"><a href={row.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold text-primary hover:underline">{row.kind === 'uploaded' ? <Download size={14} /> : <ExternalLink size={14} />}{row.name}</a><p className="mt-1 text-xs text-muted-foreground">{formatBytes(row.size)}{row.pageCount ? ` · ${row.pageCount} pages` : ''}</p></td><td className="px-4 py-3"><Link data-testid={`link-documentation-project-${row.projectId}`} href={`/projects/${row.projectId}`} className="font-semibold text-primary hover:underline">{row.projectNumber}</Link><p className="max-w-44 truncate text-xs text-muted-foreground">{row.projectName}</p><p className="max-w-44 truncate text-xs text-muted-foreground">{row.customerName}</p></td><td className="px-4 py-3"><Link href={`/submittals/${row.packageId}`} className="font-semibold text-primary hover:underline">{row.packageNumber}</Link><p className="max-w-52 truncate text-xs text-muted-foreground">{row.itemNumber} · {row.itemName}</p></td><td className="px-4 py-3"><Badge tone="neutral">{itemTypeLabel(row.itemType)}</Badge></td><td className="px-4 py-3"><Badge tone={itemStatusTone(row.itemStatus)}>{itemTypeLabel(row.itemStatus)}</Badge>{row.scanStatus && <p className="mt-1 text-[10px] text-muted-foreground">{itemTypeLabel(row.scanStatus)} scan</p>}</td><td className="px-4 py-3 text-xs text-muted-foreground">{shortDate(row.uploadedAt ?? row.updatedAt)}</td><td className="px-4 py-3 text-right"><a href={row.href} target="_blank" rel="noreferrer" aria-label={`Open ${row.name}`} className="inline-flex rounded-md p-2 text-primary hover:bg-primary/10"><ExternalLink size={15} /></a></td></tr>)}</tbody></table></div></>}
    </div>
  );
}

export default Documentation;