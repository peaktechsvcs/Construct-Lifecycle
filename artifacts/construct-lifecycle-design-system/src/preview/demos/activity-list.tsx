import { ActivityList } from "../../components/ui/activity-list"

export function ActivityListDemo() {
  return <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-card p-6"><ActivityList items={[{ id: "1", action: "Proposal sent", description: "to Atlas Builders for review.", actor: "Morgan Lee", timestamp: "Sep 10" }, { id: "2", action: "Delivery confirmed", description: "for the main cabinet package.", actor: "Jordan Kim", timestamp: "Sep 9" }, { id: "3", action: "Deposit received", description: "and applied to the contract.", actor: "Finance", timestamp: "Sep 8" }]} /></section><section className="rounded-xl border bg-card p-6"><ActivityList items={[]} /></section></div>
}