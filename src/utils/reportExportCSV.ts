import { Project, calculateTimeByParty, calculateTimeFromChecklist, formatDuration } from "@/data/projectsData";

const escapeCSV = (value: string | number | undefined | null): string => {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const downloadCSV = (csv: string, filename: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

interface Labels {
  teamLabels: Record<string, string>;
  responsibilityLabels: Record<string, string>;
  phaseLabels: Record<string, string>;
  stateLabels: Record<string, string>;
  getLabel: (key: string) => string;
}

export const exportProjectChecklistCSV = (projects: Project[], labels: Labels) => {
  const { teamLabels, responsibilityLabels, phaseLabels, stateLabels } = labels;

  const headers = [
    "Merchant Name", "MID", "Current Team", "Current Phase", "State",
    "Assigned Owner", "Tasks Completed", "Total Tasks", "Progress %",
    "GoKwik Time", "Merchant Time",
    "Checklist Item", "Item Phase", "Item Team", "Item Responsibility",
    "Item GoKwik Time", "Item Merchant Time", "Item Status",
  ];

  const rows: string[][] = [];

  projects.forEach((project) => {
    const projectTime = calculateTimeFromChecklist(project.checklist);
    const completed = project.checklist.filter(c => c.completed).length;
    const total = project.checklist.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (project.checklist.length === 0) {
      rows.push([
        project.merchantName, project.mid,
        teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam,
        phaseLabels[project.currentPhase] || project.currentPhase,
        stateLabels[project.projectState] || project.projectState,
        project.assignedOwnerName || "Unassigned",
        String(completed), String(total), String(progress),
        formatDuration(projectTime.gokwik), formatDuration(projectTime.merchant),
        "", "", "", "", "", "", "",
      ].map(escapeCSV));
    } else {
      project.checklist.forEach((item) => {
        const time = calculateTimeByParty(item.responsibilityLog);
        rows.push([
          project.merchantName, project.mid,
          teamLabels[project.currentOwnerTeam] || project.currentOwnerTeam,
          phaseLabels[project.currentPhase] || project.currentPhase,
          stateLabels[project.projectState] || project.projectState,
          project.assignedOwnerName || "Unassigned",
          String(completed), String(total), String(progress),
          formatDuration(projectTime.gokwik), formatDuration(projectTime.merchant),
          item.title,
          phaseLabels[item.phase] || item.phase,
          teamLabels[item.ownerTeam] || item.ownerTeam,
          responsibilityLabels[item.currentResponsibility] || item.currentResponsibility,
          formatDuration(time.gokwik), formatDuration(time.merchant),
          item.completed ? "Done" : "Pending",
        ].map(escapeCSV));
      });
    }
  });

  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  downloadCSV(csv, `project-checklist-report-${new Date().toISOString().split("T")[0]}.csv`);
};

export const exportTeamOwnerCSV = (
  teamOwnerReport: Array<{
    team: string; teamLabel: string; projectCount: number; pendingCount: number;
    completedTasks: number; totalTasks: number; gokwikTime: number; merchantTime: number;
    owners: Array<{
      ownerId: string; ownerName: string; totalProjects: number;
      completedTasks: number; totalTasks: number; gokwikTime: number;
      merchantTime: number; projectNames: string[];
    }>;
  }>
) => {
  const headers = [
    "Team", "Owner", "Projects", "Tasks Completed", "Total Tasks",
    "GoKwik Time", "Merchant Time", "Project Names",
  ];

  const rows: string[][] = [];

  teamOwnerReport.forEach((team) => {
    if (team.owners.length === 0) {
      rows.push([team.teamLabel, "No owners", String(team.projectCount), String(team.completedTasks), String(team.totalTasks), formatDuration(team.gokwikTime), formatDuration(team.merchantTime), ""].map(escapeCSV));
    } else {
      team.owners.forEach((owner) => {
        rows.push([
          team.teamLabel, owner.ownerName, String(owner.totalProjects),
          String(owner.completedTasks), String(owner.totalTasks),
          formatDuration(owner.gokwikTime), formatDuration(owner.merchantTime),
          owner.projectNames.join("; "),
        ].map(escapeCSV));
      });
    }
  });

  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  downloadCSV(csv, `team-owner-report-${new Date().toISOString().split("T")[0]}.csv`);
};
