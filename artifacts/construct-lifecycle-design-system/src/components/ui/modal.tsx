import * as React from "react"
import { X } from "lucide-react"
import { Button } from "./button"

export interface ModalProps {
  title: string
  children: React.ReactNode
  onClose: () => void
}

export function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-sm md:items-center md:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl md:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur md:px-7">
          <h2 id="modal-title" className="text-lg font-bold tracking-tight">{title}</h2>
          <Button variant="ghost" size="icon" aria-label="Close modal" onClick={onClose}><X /></Button>
        </header>
        <div className="p-5 md:p-7">{children}</div>
      </section>
    </div>
  )
}