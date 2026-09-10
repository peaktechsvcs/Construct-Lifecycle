import { lazy, type ComponentType } from "react"
import { ColorsPage, FontsPage, LayoutPage, OverviewPage } from "./foundations"

function lazyPage(load: () => Promise<ComponentType>) {
  return lazy(async () => ({ default: await load() }))
}

const ButtonDemo = lazyPage(() => import("./demos/button").then(({ ButtonDemo }) => ButtonDemo))
const BadgeDemo = lazyPage(() => import("./demos/badge").then(({ BadgeDemo }) => BadgeDemo))
const ModalDemo = lazyPage(() => import("./demos/modal").then(({ ModalDemo }) => ModalDemo))
const LoadingPanelDemo = lazyPage(() => import("./demos/loading-panel").then(({ LoadingPanelDemo }) => LoadingPanelDemo))
const EmptyStateDemo = lazyPage(() => import("./demos/empty-state").then(({ EmptyStateDemo }) => EmptyStateDemo))

export type PreviewEntry = { id: string; name: string; description: string; Page: ComponentType }
export type NavGroup = { name: string; entries: PreviewEntry[] }

export const DESIGN_SYSTEM = {
  title: "Construct Lifecycle Design System",
  description: "Project-centered foundations and components for construction operations.",
} as const

export const OVERVIEW_ENTRY: PreviewEntry = {
  id: "overview",
  name: "Overview",
  description: "Construct Lifecycle principles, core palette, and component pilot.",
  Page: OverviewPage,
}

export const NAV_GROUPS: NavGroup[] = [
  { name: "Colors", entries: [{ id: "color-roles", name: "Color roles", description: "Brand, surface, semantic, and navigation colors.", Page: ColorsPage }] },
  { name: "Fonts", entries: [{ id: "type-scale", name: "Typography", description: "Inter hierarchy and DM Mono operational metadata.", Page: FontsPage }] },
  { name: "Layout", entries: [{ id: "spacing-radius", name: "Spacing and radius", description: "Compact 4px rhythm and 8px corner foundation.", Page: LayoutPage }] },
  { name: "Actions", entries: [{ id: "button", name: "Button", description: "Primary, outline, ghost, danger, sizes, and states.", Page: ButtonDemo }] },
  { name: "Overlays", entries: [{ id: "modal", name: "Modal", description: "Responsive bottom-sheet and desktop dialog.", Page: ModalDemo }] },
  { name: "Data display", entries: [{ id: "badge", name: "Badge", description: "Compact operational and lifecycle status labels.", Page: BadgeDemo }, { id: "empty-state", name: "Empty state", description: "Guidance and action for zero-data views.", Page: EmptyStateDemo }] },
  { name: "Feedback", entries: [{ id: "loading-panel", name: "Loading panel", description: "Card-shaped skeleton treatment for data views.", Page: LoadingPanelDemo }] },
]

export const ALL_ENTRIES = [OVERVIEW_ENTRY, ...NAV_GROUPS.flatMap((group) => group.entries)]