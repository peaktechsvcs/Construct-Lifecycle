import { Activity as ActivityIcon } from "lucide-react"
import { EmptyState } from "./empty-state"

export interface ActivityItem {
  id: string
  action: string
  description: string
  actor?: string
  timestamp: string
}

export interface ActivityListProps {
  items: ActivityItem[]
}

export function ActivityList({ items }: ActivityListProps) {
  if (items.length === 0) {
    return <EmptyState icon={ActivityIcon} title="No activity yet" text="Updates will appear as the team moves work forward." />
  }
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={item.id} className="relative flex gap-3">
          {index < items.length - 1 && <span className="absolute left-[9px] top-6 h-[calc(100%+8px)] w-px bg-border" />}
          <span className="relative mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 border-card bg-primary/15"><span className="h-1.5 w-1.5 rounded-full bg-primary" /></span>
          <div className="min-w-0">
            <p className="text-xs leading-5"><span className="font-bold">{item.action}</span> <span className="text-muted-foreground">{item.description}</span></p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[.07em] text-muted-foreground">{item.actor || "Team"} · {item.timestamp}</p>
          </div>
        </div>
      ))}
    </div>
  )
}