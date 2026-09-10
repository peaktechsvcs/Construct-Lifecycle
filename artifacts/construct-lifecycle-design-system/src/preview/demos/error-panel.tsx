import { ErrorPanel } from "../../components/ui/error-panel"

export function ErrorPanelDemo() {
  return <div className="rounded-xl border bg-card p-6"><ErrorPanel onRetry={() => undefined} /></div>
}