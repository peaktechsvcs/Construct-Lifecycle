import * as React from "react"

export interface PageTitleProps {
  eyebrow: string
  title: string
  description: string
  action?: React.ReactNode
}

export function PageTitle({ eyebrow, title, description, action }: PageTitleProps) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-primary">{eyebrow}</p>
        <h1 className="text-3xl font-bold tracking-[-.04em] text-foreground md:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}