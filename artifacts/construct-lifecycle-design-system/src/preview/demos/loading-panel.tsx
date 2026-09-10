import { LoadingPanel } from "../../components/ui/loading-panel"
import { Row } from "../parts"

export function LoadingPanelDemo() {
  return <div className="space-y-6 rounded-xl border bg-card p-6"><Row label="Three lines"><LoadingPanel /></Row><Row label="Five lines"><LoadingPanel lines={5} /></Row></div>
}