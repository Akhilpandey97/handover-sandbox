export type TeamRole = "mint" | "integration" | "ms" | "manager" | "super_admin" | "gokwik_general" | (string & {});

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  team: TeamRole;
  avatar?: string;
}

export const teamUsers: TeamUser[] = [
  {
    id: "user-mint-1",
    name: "Priya Sharma",
    email: "priya@mint.com",
    team: "mint",
  },
  {
    id: "user-int-1",
    name: "Rahul Verma",
    email: "rahul@integration.com",
    team: "integration",
  },
  {
    id: "user-ms-1",
    name: "Anjali Patel",
    email: "anjali@ms.com",
    team: "ms",
  },
  {
    id: "user-manager-1",
    name: "Vikram Singh",
    email: "vikram@manager.com",
    team: "manager",
  },
];

export const teamLabels: Record<TeamRole, string> = {
  mint: "MINT (Presales)",
  integration: "Integration Team",
  ms: "MS (Merchant Success)",
  manager: "Manager",
  super_admin: "Super Admin",
  gokwik_general: "GoKwik General",
};

export const teamColors: Record<TeamRole, string> = {
  mint: "bg-blue-500",
  integration: "bg-purple-500",
  ms: "bg-green-500",
  manager: "bg-orange-500",
  super_admin: "bg-red-500",
  gokwik_general: "bg-teal-500",
};
