import { FolderOpen } from "lucide-react"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { EmptyState } from "../components/ui/empty-state"
import { LoadingPanel } from "../components/ui/loading-panel"

const CORE_SWATCHES = [
  { name: "Primary", className: "bg-primary" },
  { name: "Secondary", className: "bg-secondary" },
  { name: "Accent", className: "bg-accent" },
] as const

function Swatch({ name, className }: { name: string; className: string }) {
  return <div className="space-y-2"><div className={`h-16 rounded-lg border ${className}`} /><p className="text-sm font-medium">{name}</p></div>
}

export function OverviewPage() {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-6">
        <img src={`${import.meta.env.BASE_URL}logo-full.png`} alt="Construct Lifecycle" className="mb-6 h-12 w-auto object-contain object-left dark:brightness-0 dark:invert" />
        <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Construct Lifecycle</p>
        <h2 className="mt-2 text-3xl font-bold tracking-[-.04em]">From Bid to Closeout.</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">A compact, project-centered system for construction suppliers and their teams.</p>
        <div className="mt-5 grid grid-cols-3 gap-3">{CORE_SWATCHES.map((item) => <Swatch key={item.name} {...item} />)}</div>
      </section>
      <section className="rounded-xl border bg-card p-6">
        <p className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Core components</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button>Primary action</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Danger</Button></div>
        <div className="mt-4 flex flex-wrap gap-2"><Badge>Lead</Badge><Badge variant="warning">Proposal</Badge><Badge variant="info">Contracted</Badge><Badge variant="success">Closeout</Badge><Badge variant="danger">Overdue</Badge></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2"><LoadingPanel /><EmptyState icon={FolderOpen} title="No projects yet" text="Create the first project to start tracking its lifecycle." action={<Button>Create project</Button>} /></div>
      </section>
    </div>
  )
}

export function ColorsPage() {
  const supporting = [
    { name: "Background", className: "bg-background" },
    { name: "Foreground", className: "bg-foreground" },
    { name: "Muted", className: "bg-muted" },
    { name: "Destructive", className: "bg-destructive" },
    { name: "Sidebar", className: "bg-sidebar" },
  ]
  return <div className="space-y-6 rounded-xl border bg-card p-6"><section><h2 className="font-semibold">Core palette</h2><p className="mt-1 text-sm text-muted-foreground">Vivid blue leads action, navy anchors navigation, and amber draws attention.</p><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">{CORE_SWATCHES.map((item) => <Swatch key={item.name} {...item} />)}</div></section><section className="border-t pt-6"><h2 className="font-semibold">Supporting roles</h2><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">{supporting.map((item) => <Swatch key={item.name} {...item} />)}</div></section></div>
}

export function FontsPage() {
  return <div className="space-y-6 rounded-xl border bg-card p-6"><section><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Inter / UI</p><p className="mt-3 text-4xl font-bold tracking-[-.04em]">Project-centered operations</p><p className="mt-2 text-base">Inter keeps dense workflows readable at every viewport.</p></section><section className="border-t pt-6"><p className="font-mono text-xs uppercase tracking-[.12em] text-muted-foreground">DM Mono / operational metadata</p><p className="mt-3 font-mono text-sm">CL-2026-014 · SEP 10 · AWARDED</p></section></div>
}

export function LayoutPage() {
  return <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-card p-6"><h2 className="font-semibold">Spacing</h2><p className="mt-1 text-sm text-muted-foreground">A 4px base supports compact operational density.</p><div className="mt-6 space-y-4">{[4,8,12,16,24].map((size) => <div key={size} className="flex items-center gap-4"><span className="w-8 font-mono text-xs text-muted-foreground">{size}</span><div className="h-3 rounded-full bg-primary" style={{ width: size * 3 }} /></div>)}</div></section><section className="rounded-xl border bg-card p-6"><h2 className="font-semibold">Radius</h2><p className="mt-1 text-sm text-muted-foreground">An 8px base keeps controls practical and cards approachable.</p><div className="mt-6 h-32 rounded-lg border bg-secondary" /></section></div>
}