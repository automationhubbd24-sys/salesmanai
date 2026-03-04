import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";

export interface WahaSession {
  name: string;
  status?: string;
  [key: string]: unknown;
}

export interface WhatsAppContextType {
  sessions: WahaSession[];
  currentSession: WahaSession | null;
  setCurrentSession: (session: WahaSession | null) => void;
  refreshSessions: () => Promise<void>;
  loading: boolean;
  // Team Features
  isTeamMember: boolean;
  teams: { id: number; owner_email: string; permissions: any }[];
  activeTeam: { id: number; owner_email: string; permissions: any } | null;
  setActiveTeam: (team: { id: number; owner_email: string; permissions: any } | null) => void;
  viewMode: 'personal' | 'team';
  switchViewMode: (mode: 'personal' | 'team') => void;
}

const WhatsAppContext = createContext<WhatsAppContextType | undefined>(undefined);

export function WhatsAppProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<WahaSession[]>([]);
  const [currentSession, setCurrentSession] = useState<WahaSession | null>(null);
  const [loading, setLoading] = useState(true);
  const currentSessionRef = React.useRef(currentSession);
  
  // Team State
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [teams, setTeams] = useState<{ id: number; owner_email: string; permissions: any }[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ id: number; owner_email: string; permissions: any } | null>(null);

  const [viewMode, setViewMode] = useState<'personal' | 'team'>(() => {
    return (localStorage.getItem('whatsapp_view_mode') as 'personal' | 'team') || 'personal';
  });

  const switchViewMode = (mode: 'personal' | 'team') => {
    setViewMode(mode);
    localStorage.setItem('whatsapp_view_mode', mode);
    if (mode === 'personal') {
        localStorage.removeItem('active_team_owner');
    } else {
        if (activeTeam) {
            localStorage.setItem('active_team_owner', activeTeam.owner_email);
        }
    }
  };

  useEffect(() => {
    currentSessionRef.current = currentSession;
    
    // Sync current session to local storage for other pages
    if (currentSession) {
      const dbId = (currentSession as any).wp_db_id;
      if (dbId) {
          localStorage.setItem("active_wp_db_id", String(dbId));
      }
      localStorage.setItem("active_wa_session_id", currentSession.name);
      window.dispatchEvent(new Event("db-connection-changed"));
    }
  }, [currentSession]);

  const refreshSessions = React.useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setSessions([]);
        setIsTeamMember(false);
        setTeams([]);
        setActiveTeam(null);
        return;
      }

      // Fetch user's teams
      try {
        const teamRes = await fetch(`${BACKEND_URL}/api/teams/me`, {
           headers: { Authorization: `Bearer ${token}` }
        });
        if (teamRes.ok) {
            const myTeams = await teamRes.json();
                if (Array.isArray(myTeams)) {
                    // Filter teams that have relevant permissions
                    const relevantTeams = myTeams.filter((t: any) => 
                        t.permissions && 
                        Array.isArray(t.permissions.wa_sessions) && 
                        t.permissions.wa_sessions.length > 0
                    );

                    // Deduplicate teams by owner_email
                    const uniqueTeamsMap = new Map();
                    relevantTeams.forEach((t: any) => {
                        if (!uniqueTeamsMap.has(t.owner_email)) {
                            uniqueTeamsMap.set(t.owner_email, t);
                        }
                    });
                    const uniqueTeams = Array.from(uniqueTeamsMap.values());

                    setTeams(uniqueTeams);
                    setIsTeamMember(uniqueTeams.length > 0);
                    
                    // Restore active team from local storage
                    const storedOwner = localStorage.getItem('active_team_owner');
                    if (storedOwner && !activeTeam) {
                        const found = uniqueTeams.find((t: any) => t.owner_email === storedOwner);
                        if (found) setActiveTeam(found);
                    }

                    // If activeTeam is set but not in uniqueTeams anymore, clear it
                    if (activeTeam) {
                        const stillMember = uniqueTeams.find((t: any) => t.owner_email === activeTeam.owner_email);
                        if (!stillMember) setActiveTeam(null);
                        // Update activeTeam reference to the one in uniqueTeams to ensure consistency
                        else if (stillMember.id !== activeTeam.id) setActiveTeam(stillMember);
                    }
                }
        }
      } catch (err) {
        console.error("Failed to fetch teams", err);
      }

      let url = `${BACKEND_URL}/api/whatsapp/sessions`;
      if (viewMode === 'team' && activeTeam) {
          url += `?team_owner=${encodeURIComponent(activeTeam.owner_email)}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const wahaSessions = await res.json();
      const allSessions: WahaSession[] = Array.isArray(wahaSessions) ? wahaSessions : [];

      setSessions(allSessions);
      
      // Auto-select logic (Prioritize localStorage)
      const storedSessionId = localStorage.getItem("active_wa_session_id");
      const current = currentSessionRef.current;
      
      if (storedSessionId && !current) {
        const found = allSessions.find(s => s.name === storedSessionId);
        if (found) {
            setCurrentSession(found);
        } else if (allSessions.length > 0) {
            setCurrentSession(allSessions[0]);
        }
      } else if (!current && allSessions.length > 0) {
        setCurrentSession(allSessions[0]);
      } else if (current) {
        // Update current session object with latest data
        const updated = allSessions.find((s) => s.name === current.name);
        if (updated) setCurrentSession(updated);
        else setCurrentSession(null);
      }
    } catch (error) {
      console.error("Failed to fetch sessions", error);
      toast.error("Failed to load WhatsApp sessions");
    } finally {
      setLoading(false);
    }
  }, [viewMode, activeTeam]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  return (
    <WhatsAppContext.Provider value={{ 
        sessions, 
        currentSession, 
        setCurrentSession, 
        refreshSessions, 
        loading,
        isTeamMember,
        teams,
        activeTeam,
        setActiveTeam: (team) => {
            setActiveTeam(team);
            if (team) {
                localStorage.setItem('active_team_owner', team.owner_email);
            } else {
                localStorage.removeItem('active_team_owner');
            }
        },
        viewMode,
        switchViewMode
    }}>
      {children}
    </WhatsAppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWhatsApp() {
  const context = useContext(WhatsAppContext);
  if (context === undefined) {
    throw new Error("useWhatsApp must be used within a WhatsAppProvider");
  }
  return context;
}
