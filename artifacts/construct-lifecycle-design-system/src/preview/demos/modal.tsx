import { useState } from "react"
import { Button } from "../../components/ui/button"
import { Modal } from "../../components/ui/modal"

export function ModalDemo() {
  const [open, setOpen] = useState(false)
  return <div className="rounded-xl border bg-card p-6"><Button onClick={() => setOpen(true)}>Open modal</Button>{open && <Modal title="Update project" onClose={() => setOpen(false)}><p className="text-sm text-muted-foreground">Responsive project workspaces use this pattern for focused create and edit tasks.</p></Modal>}</div>
}