export type TeamWorkspace = {
  viewMode: "personal" | "team";
  activeTeam: { permissions: unknown } | null;
};

type PermissionRecord = Record<string, unknown>;

const asRecord = (value: unknown): PermissionRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as PermissionRecord) : {};

/** Personal workspaces retain full access; team access is determined by activeTeam.permissions. */
export function hasWorkspacePermission(workspace: TeamWorkspace | null | undefined, permission: "smart_inbox" | "orders" | "conversion" | "ai_settings" | "control_panel" | "team_management") {
  if (!workspace || workspace.viewMode !== "team") return true;
  if (permission === "team_management") return false;

  const value = asRecord(workspace.activeTeam?.permissions)[permission];
  if (value === true) return true;
  const access = asRecord(value);

  if (permission === "orders") return Boolean(access.view_assigned || access.view_all);
  return Boolean(access.view);
}

export function teamWorkspaceFromStorage(platform: "whatsapp" | "messenger" | "instagram" | null): TeamWorkspace {
  const modeKey = platform === "whatsapp" ? "whatsapp_view_mode" : platform === "messenger" ? "messenger_view_mode" : null;
  const isTeamMode = modeKey
    ? localStorage.getItem(modeKey) === "team"
    : localStorage.getItem("whatsapp_view_mode") === "team" || localStorage.getItem("messenger_view_mode") === "team";
  const viewMode = isTeamMode ? "team" : "personal";
  try {
    const permissions = JSON.parse(localStorage.getItem("active_team_permissions") || "{}");
    return { viewMode, activeTeam: viewMode === "team" ? { permissions } : null };
  } catch {
    return { viewMode, activeTeam: null };
  }
}

export function workspacePermissionForPath(pathname: string) {
  if (pathname.endsWith("/smart-inbox")) return "smart_inbox" as const;
  if (pathname.endsWith("/orders")) return "orders" as const;
  if (pathname.endsWith("/conversion")) return "conversion" as const;
  if (pathname.endsWith("/settings")) return "ai_settings" as const;
  if (pathname.endsWith("/control")) return "control_panel" as const;
  if (pathname === "/dashboard/team-management") return "team_management" as const;
  return null;
}
