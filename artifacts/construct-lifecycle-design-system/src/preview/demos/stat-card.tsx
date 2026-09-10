import { CircleDollarSign, FolderKanban, Truck, WalletCards } from "lucide-react"
import { StatCard } from "../../components/ui/stat-card"

export function StatCardDemo() {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Open pipeline" value="$2.4M" detail="18 active opportunities" icon={FolderKanban} /><StatCard label="Awarded" value="$940K" detail="6 projects this quarter" icon={CircleDollarSign} accent="warning" /><StatCard label="In delivery" value="12" detail="3 due this week" icon={Truck} accent="info" /><StatCard label="Outstanding" value="$186K" detail="Across 8 invoices" icon={WalletCards} accent="success" /></div>
}