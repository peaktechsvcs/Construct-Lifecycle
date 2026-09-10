export interface LoadingPanelProps {
  lines?: number
}

export function LoadingPanel({ lines = 3 }: LoadingPanelProps) {
  return (
    <div aria-label="Loading" className="space-y-3 rounded-xl border border-border bg-card p-5">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className={`h-4 animate-pulse rounded bg-muted ${index === 0 ? "w-1/3" : index === 1 ? "w-4/5" : "w-2/3"}`} />
      ))}
    </div>
  )
}