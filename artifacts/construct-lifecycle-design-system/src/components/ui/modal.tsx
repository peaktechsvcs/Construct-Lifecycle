import * as React from "react"
import { X } from "lucide-react"
import { Button } from "./button"

export interface ModalProps {
  title: string
  children: React.ReactNode
  onClose: () => void
}

export function Modal({ title, children, onClose }: ModalProps) {
  const titleId = React.useId()
  const dialogRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    ) ?? [])
    const onFocus = () => {
      if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      if (event.key === "Tab") {
        const items = focusable()
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("focusin", onFocus)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("focusin", onFocus)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-sm md:items-center md:p-6">
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl outline-none md:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur md:px-7">
          <h2 id={titleId} className="text-lg font-bold tracking-tight">{title}</h2>
          <Button variant="ghost" size="icon" aria-label="Close modal" onClick={onClose}><X /></Button>
        </header>
        <div className="p-5 md:p-7">{children}</div>
      </section>
    </div>
  )
}