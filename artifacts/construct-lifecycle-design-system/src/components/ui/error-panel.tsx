import { CircleAlert } from "lucide-react"
import { Button } from "./button"

export interface ErrorPanelProps {
  onRetry: () => void
  title?: string
  text?: string
}

export function ErrorPanel({
  onRetry,
  title = "We couldn't load this view.",
  text = "Try again in a moment.",
}: ErrorPanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <CircleAlert className="h-[19px] w-[19px] shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{text}</p>
        </div>
      </div>
      <Button variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  )
}