import * as React from "react"
import type { LucideIcon } from "lucide-react"

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  text: string
  action?: React.ReactNode
}

export function EmptyState({ icon: Icon, title, text, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-5 py-9 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Icon className="h-[18px] w-[18px]" /></span>
      <p className="text-sm font-bold">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}