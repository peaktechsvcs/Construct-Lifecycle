import { Button } from "../../components/ui/button"
import { PageTitle } from "../../components/ui/page-title"

export function PageTitleDemo() {
  return <div className="rounded-xl border bg-card p-6"><PageTitle eyebrow="Project book" title="Projects" description="Track every opportunity, commitment, delivery, and payment in one operational workspace." action={<Button>New project</Button>} /></div>
}