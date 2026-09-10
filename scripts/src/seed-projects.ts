import { db, activityTable, followUpsTable, projectsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const seed = async () => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectsTable);
  if (Number(count) > 0) return;

  const projects = await db
    .insert(projectsTable)
    .values([
      {
        projectNumber: "CP-2026-001",
        customerName: "Northline Builders",
        projectName: "Cedar Ridge Clubhouse",
        address: "1720 Ridgeview Dr, Denver, CO",
        category: "Commercial",
        productCategories: ["Cabinetry", "Countertops", "Hardware"],
        owner: "Maya Chen",
        stage: "in_progress",
        proposalStatus: "accepted",
        proposalDetails: "Value-engineered kitchen and locker room package.",
        bidOutcome: "won",
        contractStatus: "active",
        contractValue: "184500",
        contractDetails: "Three-phase install with owner-furnished appliances.",
        contractStart: "2026-08-10",
        contractEnd: "2026-11-21",
        deliveryPercent: 62,
        requirementsSummary: "Release cabinets by building wing; final hardware count due before phase three.",
        billingStatus: "partially_paid",
        invoicedAmount: "110700",
        receivedAmount: "83025",
        billingDetails: "Deposit and first progress draw received; second draw due Friday.",
        closeoutStatus: "not_started",
        nextFollowUp: "2026-09-14",
      },
      {
        projectNumber: "CP-2026-002",
        customerName: "Alpine Residential",
        projectName: "Morrison Kitchen + Main Floor",
        address: "48 Aspen Way, Morrison, CO",
        category: "Residential",
        productCategories: ["Cabinetry", "Countertops", "Flooring", "Lighting"],
        owner: "Jordan Ellis",
        stage: "proposal",
        proposalStatus: "submitted",
        proposalDetails: "Walnut inset cabinets, quartz counters, engineered oak floors.",
        bidOutcome: "pending",
        contractStatus: "none",
        contractValue: "78200",
        deliveryPercent: 0,
        requirementsSummary: "Waiting on appliance specifications and final lighting plan.",
        billingStatus: "not_started",
        invoicedAmount: "0",
        receivedAmount: "0",
        closeoutStatus: "not_started",
        nextFollowUp: "2026-09-11",
      },
      {
        projectNumber: "CP-2026-003",
        customerName: "West & Pine Design",
        projectName: "Baker Row Townhomes",
        address: "906 W 4th Ave, Denver, CO",
        category: "Multi-family",
        productCategories: ["Cabinetry", "Countertops", "Hardware"],
        owner: "Maya Chen",
        stage: "awarded",
        proposalStatus: "accepted",
        proposalDetails: "Standardized package across 12 townhome units.",
        bidOutcome: "won",
        contractStatus: "requested",
        contractValue: "316000",
        deliveryPercent: 8,
        requirementsSummary: "Confirm color match sample before production release.",
        billingStatus: "deposit_pending",
        invoicedAmount: "31600",
        receivedAmount: "0",
        closeoutStatus: "not_started",
        nextFollowUp: "2026-09-15",
      },
      {
        projectNumber: "CP-2026-004",
        customerName: "Juniper & Stone",
        projectName: "Lone Tree Primary Suite",
        address: "6200 Willow Creek Rd, Lone Tree, CO",
        category: "Residential",
        productCategories: ["Flooring", "Lighting", "Hardware"],
        owner: "Jordan Ellis",
        stage: "closeout",
        proposalStatus: "accepted",
        proposalDetails: "Flooring and decorative lighting refresh.",
        bidOutcome: "won",
        contractStatus: "complete",
        contractValue: "42100",
        contractDetails: "Final walk-through scheduled with homeowner.",
        contractStart: "2026-06-02",
        contractEnd: "2026-08-18",
        deliveryPercent: 100,
        requirementsSummary: "Replacement dimmer arrived; install and final sign-off remain.",
        billingStatus: "invoicing",
        invoicedAmount: "42100",
        receivedAmount: "37890",
        billingDetails: "Final balance will be billed after punch list.",
        closeoutStatus: "punch_list",
        closeoutDetails: "One dimmer replacement and two touch-ups outstanding.",
        nextFollowUp: "2026-09-18",
      },
    ])
    .returning();

  await db.insert(activityTable).values([
    {
      projectId: projects[0].id,
      action: "Progress payment received",
      description: "Received $27,675 against the second progress draw.",
      actor: "Maya Chen",
    },
    {
      projectId: projects[1].id,
      action: "Proposal submitted",
      description: "Proposal sent to Alpine Residential for review.",
      actor: "Jordan Ellis",
    },
    {
      projectId: projects[2].id,
      action: "Bid awarded",
      description: "West & Pine Design selected the standardized townhome package.",
      actor: "Maya Chen",
    },
    {
      projectId: projects[3].id,
      action: "Closeout started",
      description: "Punch list opened after the final walk-through.",
      actor: "Jordan Ellis",
    },
  ]);

  await db.insert(followUpsTable).values([
    {
      projectId: projects[1].id,
      dueDate: "2026-09-11",
      note: "Call to confirm appliance specifications and answer proposal questions.",
    },
    {
      projectId: projects[0].id,
      dueDate: "2026-09-14",
      note: "Review wing two delivery readiness and collect second progress draw.",
    },
    {
      projectId: projects[2].id,
      dueDate: "2026-09-15",
      note: "Send contract packet and confirm color match sample appointment.",
    },
    {
      projectId: projects[3].id,
      dueDate: "2026-09-18",
      note: "Check replacement dimmer install and ask about next phase work.",
    },
  ]);
};

await seed();