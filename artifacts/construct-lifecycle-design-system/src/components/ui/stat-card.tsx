import type { LucideIcon } from "lucide-react"

export interface StatCardProps {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  accent?: "primary" | "warning" | "info" | "success"
}

export function StatCard({ label, value, detail, icon: Icon, accent = "primary" }: StatCardProps) {
  const color = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-accent/15 text-accent-foreground",
    info: "bg-chart-2/10 text-chart-2",
    success: "bg-chart-3/10 text-chart-3",
  }[accent]
  return (
    <div className="group rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(var(--border))] transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-5 text-2xl font-bold tracking-[-.05em]">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}