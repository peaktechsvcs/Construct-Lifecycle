import { FolderOpen } from "lucide-react"
import { Button } from "../../components/ui/button"
import { EmptyState } from "../../components/ui/empty-state"

export function EmptyStateDemo() {
  return <div className="rounded-xl border bg-card p-6"><EmptyState icon={FolderOpen} title="No projects yet" text="Create the first project to start tracking its lifecycle." action={<Button>Create project</Button>} /></div>
}