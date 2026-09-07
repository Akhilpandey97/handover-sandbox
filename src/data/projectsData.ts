import { getActiveFunnelStages, resolveFunnelStage } from "@/data/funnelConfig";
import { TeamRole } from "./teams";

export type ProjectPhase = "mint" | "integration" | "ms" | "completed";
export type ResponsibilityParty = "gokwik" | "merchant" | "neutral";
export type ProjectState = "not_started" | "on_hold" | "in_progress" | "live" | "blocked";

export const projectStateLabels: Record<ProjectState, string> = {
  not_started: "Not Started",
  on_hold: "On-Hold",
  in_progress: "In Progress",
  live: "Live",
  blocked: "Blocked",
};

export const projectStateColors: Record<ProjectState, string> = {
  not_started: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  on_hold: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  live: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

export interface TransferRecord {
  id: string;
  fromTeam: TeamRole;
  toTeam: TeamRole;
  transferredBy: string;
  acceptedBy?: string;
  transferredAt: string;
  acceptedAt?: string;
  notes?: string;
}

export interface ResponsibilityLog {
  id: string;
  party: ResponsibilityParty;
  startedAt: string;
  endedAt?: string;
  phase: ProjectPhase;
}

export interface ChecklistResponsibilityLog {
  id: string;
  party: ResponsibilityParty;
  startedAt: string;
  endedAt?: string;
}

export interface ProjectChecklist {
  id: string;
  title: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  phase: ProjectPhase | string;
  ownerTeam: TeamRole; // Which team can complete this item
  currentResponsibility: ResponsibilityParty;
  responsibilityLog: ChecklistResponsibilityLog[];
  comment?: string;
  commentBy?: string;
  commentAt?: string;
  isTask?: boolean; // Tasks sit on top of checklists
  dueDate?: string; // Auto-calculated or manually overridden
}

export interface ProjectLinks {
  brandUrl: string;
  jiraLink?: string;
  brdLink?: string;
  mintChecklistLink?: string;
  integrationChecklistLink?: string;
  sowLink?: string;
}

export interface ProjectDates {
  kickOffDate: string;
  goLiveDate?: string;
  expectedGoLiveDate?: string;
  /**
   * True when expectedGoLiveDate was filled in from the latest checklist due
   * date rather than set on the project. Risk rules use this to avoid reporting
   * a missed go-live that is really just the missed checklist item restated.
   */
  expectedGoLiveDateIsDerived?: boolean;
}

export interface ProjectNotes {
  mintNotes?: string;
  projectNotes?: string;
  currentPhaseComment?: string;
  phase2Comment?: string;
  opsComment?: string;
}

export interface ProjectFaqHelp {
  id: string;
  question: string;
  answer: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  merchantName: string;
  mid: string;
  platform: string;
  arr: number;
  txnsPerDay: number;
  aov: number;
  category: string;
  currentPhase: ProjectPhase;
  currentOwnerTeam: TeamRole;
  pendingAcceptance: boolean;
  goLivePercent: number;
  links: ProjectLinks;
  dates: ProjectDates;
  notes: ProjectNotes;
  transferHistory: TransferRecord[];
  checklist: ProjectChecklist[];
  salesSpoc: string;
  integrationType: string;
  pgOnboarding: string;
  currentResponsibility: ResponsibilityParty;
  responsibilityLog: ResponsibilityLog[];
  assignedOwner?: string; // User ID of the assigned owner
  projectState: ProjectState;
  assignedOwnerName?: string; // Display name of the assigned owner
  archived?: boolean;
  archivedAt?: string;
  contactEmail?: string;
  configId?: string;
  updatedAt?: string;
  // Credentials (CE-managed)
  sandboxMid?: string;
  sandboxAppId?: string;
  sandboxAppSecret?: string;
  sandboxBaseUrl?: string;
  sandboxConfigId?: string;
  sandboxKwikpassJweKey?: string;
  prodMid?: string;
  prodAppId?: string;
  prodAppSecret?: string;
  prodBaseUrl?: string;
  prodConfigId?: string;
  prodKwikpassJweKey?: string;
  mcpConfigId?: string;
  enableMcpDocument?: boolean;
  enableKp?: boolean;
  kpProdJweKey?: string;
  kpSandboxJweKey?: string;
  mandatoryApis?: string[];
  faqHelp?: ProjectFaqHelp[];
  paymentSimulatorLink?: string;
}

// Helper to calculate time spent by each party (neutral time is not counted)
export const calculateTimeByParty = (logs: ResponsibilityLog[] | ChecklistResponsibilityLog[]): { gokwik: number; merchant: number; neutral: number } => {
  const result = { gokwik: 0, merchant: 0, neutral: 0 };
  
  logs.forEach(log => {
    if (log.party === "neutral") return; // Don't count neutral time
    const start = new Date(log.startedAt).getTime();
    const end = log.endedAt ? new Date(log.endedAt).getTime() : Date.now();
    const duration = end - start;
    result[log.party] += duration;
  });
  
  return result;
};

export const formatDuration = (ms: number): string => {
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (totalHours > 0) {
    return `${totalHours}h ${minutes}m`;
  }
  return `${minutes}m`;
};
// Check if a project qualifies as "Under Integration"
// Logic: these 4 MINT checklist items are ALL completed:
// Requirement Gathering, API Walkthrough, API Build & SDK Integration, API Validation
export const isProjectUnderIntegration = (project: Project): boolean => {
  const requiredTitles = ["requirement gathering", "api walkthrough", "api build & sdk integration", "api validation"];
  const items = project.checklist.filter(c => !c.isTask);
  return requiredTitles.every(req => {
    const item = items.find(c => c.title.toLowerCase().includes(req));
    return item && item.completed;
  });
};

// Live: project state is "live"
export const isProjectLive = (project: Project): boolean => project.projectState === "live";

const FUNNEL_ANY_TITLES = [
  "feasibility analysis",
  "pg onboarding",
  "requirement gathering",
  "api walkthrough",
  "api build & sdk integration",
  "api validation",
  "under integration",
  "sandbox testing",
  "production testing",
  "dashboard walkthrough",
  "go-live",
];

// Sales: none of the funnel checklist items are completed
export const isProjectSales = (project: Project): boolean => {
  const items = project.checklist.filter(c => !c.isTask);
  return !FUNNEL_ANY_TITLES.some(t =>
    items.some(i => i.title.toLowerCase().includes(t) && i.completed)
  );
};

// Pre Integration: Feasibility Analysis completed AND ANY of the 4 integration items are uncompleted
export const isProjectPreIntegration = (project: Project): boolean => {
  const items = project.checklist.filter(c => !c.isTask);
  const feasibility = items.find(i => i.title.toLowerCase().includes("feasibility analysis"));
  if (!feasibility || !feasibility.completed) return false;
  const blockers = ["requirement gathering", "api walkthrough", "api build & sdk integration", "api validation"];
  return blockers.some(b => {
    const item = items.find(i => i.title.toLowerCase().includes(b));
    return !item || !item.completed;
  });
};

export type FunnelStage = string;

const DEFAULT_FUNNEL_LABELS: Record<string, string> = {
  live: "Live",
  under_integration: "Under Integration",
  pre_integration: "Pre Integration",
  sales: "Sales",
  none: "None",
};

// Labels resolve against the tenant's configured project stages (Settings -> Project Stages),
// falling back to the built-in defaults.
export const funnelStageLabels: Record<string, string> = new Proxy(
  {},
  {
    get: (_t, key: string) => {
      const match = getActiveFunnelStages().find((s) => s.id === key);
      return match?.label ?? DEFAULT_FUNNEL_LABELS[key] ?? key;
    },
    ownKeys: () => [...getActiveFunnelStages().map((s) => s.id), "none"],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
) as Record<string, string>;

export const getProjectFunnelStage = (project: Project): FunnelStage =>
  resolveFunnelStage(project, getActiveFunnelStages());

// Calculate project responsibility automatically based on checklist items
export const calculateProjectResponsibilityFromChecklist = (checklist: ProjectChecklist[]): ResponsibilityParty => {
  // Get all uncompleted, non-neutral items
  const activeItems = checklist.filter(item => !item.completed && item.currentResponsibility !== "neutral");
  
  if (activeItems.length === 0) {
    return "neutral";
  }
  
  // If any active item is on merchant, project is on merchant
  const hasMerchantItem = activeItems.some(item => item.currentResponsibility === "merchant");
  if (hasMerchantItem) {
    return "merchant";
  }
  
  // Otherwise, all active items are on gokwik
  return "gokwik";
};

// Calculate time from checklist items instead of project-level logs
export const calculateTimeFromChecklist = (checklist: ProjectChecklist[]): { gokwik: number; merchant: number; neutral: number } => {
  const result = { gokwik: 0, merchant: 0, neutral: 0 };
  
  checklist.forEach(item => {
    const itemTime = calculateTimeByParty(item.responsibilityLog);
    result.gokwik += itemTime.gokwik;
    result.merchant += itemTime.merchant;
  });
  
  return result;
};

// MINT Checklist Items
const mintChecklistItems = [
  "Requirement gathering",
  "Feasibility Analysis",
  "BRD Details",
  "Technical Scoping",
  "Technical Walkthrough",
  "API Validation",
  "LCNC Config",
  "Create JIRA",
  "Transfer to Integration",
];

// Integration Checklist Items
const integrationChecklistItems = [
  "BRD Validation",
  "Integration Checklist",
  "Sandbox Testing",
  "Production Testing",
  "Dashboard Walkthrough with MS",
  "Go-Live",
];

export const createDefaultChecklist = (): ProjectChecklist[] => {
  const checklist: ProjectChecklist[] = [];

  mintChecklistItems.forEach((title, idx) => {
    checklist.push({
      id: `c-mint-${Date.now()}-${idx}`,
      title,
      completed: false,
      phase: "mint",
      ownerTeam: "mint",
      currentResponsibility: "neutral",
      responsibilityLog: [],
    });
  });

  integrationChecklistItems.forEach((title, idx) => {
    checklist.push({
      id: `c-int-${Date.now()}-${idx}`,
      title,
      completed: false,
      phase: "integration",
      ownerTeam: "integration",
      currentResponsibility: "neutral",
      responsibilityLog: [],
    });
  });

  return checklist;
};

export const createDefaultProject = (overrides?: Partial<Project>): Project => ({
  id: `proj-${Date.now()}`,
  merchantName: "",
  mid: "",
  platform: "Custom",
  arr: 0,
  txnsPerDay: 0,
  aov: 0,
  category: "",
  currentPhase: "mint",
  currentOwnerTeam: "mint",
  pendingAcceptance: false,
  goLivePercent: 0,
  links: {
    brandUrl: "",
    jiraLink: "",
    brdLink: "",
    mintChecklistLink: "",
    integrationChecklistLink: "",
  },
  dates: {
    kickOffDate: new Date().toISOString().split("T")[0],
    goLiveDate: undefined,
    expectedGoLiveDate: undefined,
  },
  notes: {
    mintNotes: "",
    projectNotes: "",
    currentPhaseComment: "",
    phase2Comment: "",
  },
  transferHistory: [],
  checklist: createDefaultChecklist(),
  salesSpoc: "",
  integrationType: "Standard",
  pgOnboarding: "",
  currentResponsibility: "gokwik",
  projectState: "not_started",
  responsibilityLog: [
    {
      id: `r-${Date.now()}`,
      party: "gokwik",
      startedAt: new Date().toISOString(),
      phase: "mint",
    },
  ],
  ...overrides,
});

// Helper to create checklist for existing projects
const createChecklistForProject = (projectId: string, completedItems: { title: string; phase: ProjectPhase }[]): ProjectChecklist[] => {
  const now = new Date().toISOString();
  const checklist: ProjectChecklist[] = [];

  mintChecklistItems.forEach((title, idx) => {
    const isCompleted = completedItems.some(item => item.title === title);
    checklist.push({
      id: `${projectId}-c-mint-${idx}`,
      title,
      completed: isCompleted,
      completedAt: isCompleted ? now : undefined,
      phase: "mint",
      ownerTeam: "mint",
      currentResponsibility: "neutral",
      responsibilityLog: [],
    });
  });

  integrationChecklistItems.forEach((title, idx) => {
    const isCompleted = completedItems.some(item => item.title === title);
    checklist.push({
      id: `${projectId}-c-int-${idx}`,
      title,
      completed: isCompleted,
      completedAt: isCompleted ? now : undefined,
      phase: "integration",
      ownerTeam: "integration",
      currentResponsibility: "neutral",
      responsibilityLog: [],
    });
  });

  return checklist;
};

export const initialProjects: Project[] = [
  {
    id: "proj-1",
    merchantName: "Ethera Diamonds",
    mid: "19tpy3qnz5dq",
    platform: "Custom",
    arr: 8.135,
    txnsPerDay: 8,
    aov: 50000,
    category: "Gems & Jewellery",
    currentPhase: "mint",
    currentOwnerTeam: "mint",
    pendingAcceptance: false,
    goLivePercent: 45,
    links: {
      brandUrl: "https://www.etheradiamonds.com/",
      jiraLink: "https://gokwik.atlassian.net/browse/CUST-262",
      brdLink: "https://docs.google.com/spreadsheets/d/example",
      mintChecklistLink: "https://docs.google.com/document/d/mint-checklist",
      integrationChecklistLink: "https://docs.google.com/document/d/int-checklist",
    },
    dates: {
      kickOffDate: "2025-01-13",
      goLiveDate: undefined,
      expectedGoLiveDate: "2025-02-15",
    },
    notes: {
      mintNotes: "High priority client, CEO directly involved",
      projectNotes: "Checkout lite, PAN card implementation and KP Integration",
      currentPhaseComment: "Initial scoping and API walkthrough is done. Awaiting update on API dev.",
      phase2Comment: "",
    },
    salesSpoc: "Saurabh",
    integrationType: "Advanced",
    pgOnboarding: "Easebuzz",
    transferHistory: [],
    checklist: createChecklistForProject("proj-1", [
      { title: "Requirement gathering", phase: "mint" },
      { title: "Feasibility Analysis", phase: "mint" },
    ]),
    currentResponsibility: "merchant",
    projectState: "in_progress",
    responsibilityLog: [
      { id: "r1", party: "gokwik", startedAt: "2025-01-13T09:00:00Z", endedAt: "2025-01-15T14:00:00Z", phase: "mint" },
      { id: "r2", party: "merchant", startedAt: "2025-01-15T14:00:00Z", phase: "mint" },
    ],
  },
  {
    id: "proj-2",
    merchantName: "Livspace",
    mid: "19u5u9kt1urj",
    platform: "Custom",
    arr: 0.1,
    txnsPerDay: 15,
    aov: 25000,
    category: "Home Decor",
    currentPhase: "integration",
    currentOwnerTeam: "integration",
    pendingAcceptance: true,
    goLivePercent: 60,
    links: {
      brandUrl: "https://www.livspace.com/",
      jiraLink: "https://gokwik.atlassian.net/browse/CUST-301",
      brdLink: "",
      mintChecklistLink: "https://docs.google.com/document/d/mint-checklist-2",
      integrationChecklistLink: "https://docs.google.com/document/d/int-checklist-2",
    },
    dates: {
      kickOffDate: "2025-01-14",
      goLiveDate: undefined,
      expectedGoLiveDate: "2025-02-28",
    },
    notes: {
      mintNotes: "Fast-track requested by sales",
      projectNotes: "Standard checkout integration",
      currentPhaseComment: "API development in progress",
      phase2Comment: "Need to coordinate with merchant tech team",
    },
    salesSpoc: "Amit",
    integrationType: "Standard",
    pgOnboarding: "Razorpay",
    transferHistory: [
      {
        id: "t1",
        fromTeam: "mint",
        toTeam: "integration",
        transferredBy: "Priya Sharma",
        transferredAt: "2025-01-16T10:30:00Z",
        notes: "All documentation complete, ready for integration",
      },
    ],
    checklist: createChecklistForProject("proj-2", [
      { title: "Requirement gathering", phase: "mint" },
      { title: "Feasibility Analysis", phase: "mint" },
      { title: "BRD Details", phase: "mint" },
      { title: "Technical Scoping", phase: "mint" },
      { title: "Technical Walkthrough", phase: "mint" },
      { title: "API Validation", phase: "mint" },
      { title: "LCNC Config", phase: "mint" },
      { title: "Create JIRA", phase: "mint" },
      { title: "Transfer to Integration", phase: "mint" },
    ]),
    currentResponsibility: "gokwik",
    projectState: "in_progress",
    responsibilityLog: [
      { id: "r1", party: "gokwik", startedAt: "2025-01-14T09:00:00Z", endedAt: "2025-01-15T16:00:00Z", phase: "mint" },
      { id: "r2", party: "merchant", startedAt: "2025-01-15T16:00:00Z", endedAt: "2025-01-16T10:30:00Z", phase: "mint" },
      { id: "r3", party: "gokwik", startedAt: "2025-01-16T10:30:00Z", phase: "integration" },
    ],
  },
  {
    id: "proj-3",
    merchantName: "Urban Company",
    mid: "19abc123xyz",
    platform: "Shopify",
    arr: 12.5,
    txnsPerDay: 120,
    aov: 1500,
    category: "Services",
    currentPhase: "ms",
    currentOwnerTeam: "ms",
    pendingAcceptance: true,
    goLivePercent: 85,
    links: {
      brandUrl: "https://www.urbancompany.com/",
      jiraLink: "https://gokwik.atlassian.net/browse/CUST-198",
      brdLink: "",
      mintChecklistLink: "https://docs.google.com/document/d/mint-checklist-3",
      integrationChecklistLink: "https://docs.google.com/document/d/int-checklist-3",
    },
    dates: {
      kickOffDate: "2024-12-01",
      goLiveDate: "2025-01-20",
      expectedGoLiveDate: "2025-01-20",
    },
    notes: {
      mintNotes: "Enterprise client",
      projectNotes: "Full checkout suite with loyalty integration",
      currentPhaseComment: "Final testing before go-live",
      phase2Comment: "Merchant team validated all test cases",
    },
    salesSpoc: "Neha",
    integrationType: "Enterprise",
    pgOnboarding: "PayU",
    transferHistory: [
      {
        id: "t1",
        fromTeam: "mint",
        toTeam: "integration",
        transferredBy: "Priya Sharma",
        acceptedBy: "Rahul Verma",
        transferredAt: "2024-12-10T09:00:00Z",
        acceptedAt: "2024-12-10T11:00:00Z",
        notes: "All documentation complete",
      },
      {
        id: "t2",
        fromTeam: "integration",
        toTeam: "ms",
        transferredBy: "Rahul Verma",
        transferredAt: "2025-01-15T14:00:00Z",
        notes: "Integration complete, ready for go-live support",
      },
    ],
    checklist: createChecklistForProject("proj-3", [
      { title: "Requirement gathering", phase: "mint" },
      { title: "Feasibility Analysis", phase: "mint" },
      { title: "BRD Details", phase: "mint" },
      { title: "Technical Scoping", phase: "mint" },
      { title: "Technical Walkthrough", phase: "mint" },
      { title: "API Validation", phase: "mint" },
      { title: "LCNC Config", phase: "mint" },
      { title: "Create JIRA", phase: "mint" },
      { title: "Transfer to Integration", phase: "mint" },
      { title: "BRD Validation", phase: "integration" },
      { title: "Integration Checklist", phase: "integration" },
      { title: "Sandbox Testing", phase: "integration" },
      { title: "Production Testing", phase: "integration" },
      { title: "Dashboard Walkthrough with MS", phase: "integration" },
      { title: "Go-Live", phase: "integration" },
    ]),
    currentResponsibility: "gokwik",
    projectState: "live",
    responsibilityLog: [
      { id: "r1", party: "gokwik", startedAt: "2024-12-01T09:00:00Z", endedAt: "2024-12-05T17:00:00Z", phase: "mint" },
      { id: "r2", party: "merchant", startedAt: "2024-12-05T17:00:00Z", endedAt: "2024-12-10T09:00:00Z", phase: "mint" },
      { id: "r3", party: "gokwik", startedAt: "2024-12-10T11:00:00Z", endedAt: "2025-01-10T12:00:00Z", phase: "integration" },
      { id: "r4", party: "merchant", startedAt: "2025-01-10T12:00:00Z", endedAt: "2025-01-15T14:00:00Z", phase: "integration" },
      { id: "r5", party: "gokwik", startedAt: "2025-01-15T14:00:00Z", phase: "ms" },
    ],
  },
];
