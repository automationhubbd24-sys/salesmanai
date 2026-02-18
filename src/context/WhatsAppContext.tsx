import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
  teamOwnerEmail: string | null;
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
  const [teamOwnerEmail, setTeamOwnerEmail] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'personal' | 'team'>(() => {
    return (localStorage.getItem('whatsapp_view_mode') as 'personal' | 'team') || 'personal';
  });

  const switchViewMode = (mode: 'personal' | 'team') => {
    setViewMode(mode);
    localStorage.setItem('whatsapp_view_mode', mode);
  };

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const refreshSessions = React.useCallback(async () => {
    setLoading(true);
    try {
      // 1. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
          setSessions([]);
          return;
      }

      // Check Team Membership (Allow Multiple Teams)
      const { data: teamData } = await (supabase
          .from('team_members') as any)
          .select('id, owner_email, permissions, status')
          .eq('member_email', user.email)
          .eq('status', 'active');
      
      const rawTeams = teamData || [];
      const teamMap = new Map<string, any>();
      rawTeams.forEach((row: any) => {
          const key = row.owner_email;
          if (!key) return;
          if (!teamMap.has(key)) {
              teamMap.set(key, row);
          } else {
              const existing = teamMap.get(key);
              const merged: any = { ...existing };
              const fb1 = existing?.permissions?.fb_pages;
              const fb2 = row?.permissions?.fb_pages;
              const wa1 = existing?.permissions?.wa_sessions;
              const wa2 = row?.permissions?.wa_sessions;
              merged.permissions = {
                  ...(existing.permissions || {}),
                  ...(row.permissions || {}),
                  fb_pages: Array.from(
                      new Set([
                          ...(Array.isArray(fb1) ? fb1 : []),
                          ...(Array.isArray(fb2) ? fb2 : []),
                      ])
                  ),
                  wa_sessions: Array.from(
                      new Set([
                          ...(Array.isArray(wa1) ? wa1 : []),
                          ...(Array.isArray(wa2) ? wa2 : []),
                      ])
                  ),
              };
              teamMap.set(key, merged);
          }
      });
      const foundTeams = Array.from(teamMap.values());
      setIsTeamMember(foundTeams.length > 0);
      setTeams(foundTeams);

      // Restore active team from storage or default to first
      let currentActiveTeam = activeTeam;
      if (viewMode === 'team' && foundTeams.length > 0) {
          const storedOwner = localStorage.getItem('active_team_owner_wa');
          if (storedOwner) {
              const matched = foundTeams.find((t: any) => t.owner_email === storedOwner);
              if (matched) currentActiveTeam = matched;
              else currentActiveTeam = foundTeams[0];
          } else if (!currentActiveTeam) {
              currentActiveTeam = foundTeams[0];
          }
          if (currentActiveTeam !== activeTeam) {
             setActiveTeam(currentActiveTeam);
          }
          setTeamOwnerEmail(currentActiveTeam?.owner_email || null);
      } else {
          setTeamOwnerEmail(null);
      }

      // 2. Fetch all from WAHA via Backend
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const res = await fetch(`${BACKEND_URL}/whatsapp/sessions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const wahaSessions = await res.json();
      const allSessions: WahaSession[] = Array.isArray(wahaSessions) ? wahaSessions : [];

      let formattedSessions: WahaSession[] = [];

      if (viewMode === 'team' && isTeamMember) {
          let shared = allSessions.filter((s: any) => s.is_shared);
          if (activeTeam && Array.isArray(activeTeam.permissions?.wa_sessions) && activeTeam.permissions.wa_sessions.length > 0) {
              const allowedNames = activeTeam.permissions.wa_sessions.map((name: any) => String(name));
              shared = shared.filter((s: any) => allowedNames.includes(String(s.session_name)));
          }
          formattedSessions = shared;
      } else {
          formattedSessions = allSessions.filter((s: any) => !s.is_shared);
      }
      
      setSessions(formattedSessions);
      
      // Auto-select first if none selected
      const current = currentSessionRef.current;
      if (!current && formattedSessions.length > 0) {
        setCurrentSession(formattedSessions[0]);
      } else if (current) {
        // Update current session object with latest data
        const updated = formattedSessions.find((s) => s.name === current.name);
        if (updated) setCurrentSession(updated);
        else setCurrentSession(null);
      }
    } catch (error) {
      console.error("Failed to fetch sessions", error);
      toast.error("Failed to load WhatsApp sessions");
    } finally {
      setLoading(false);
    }
  }, [viewMode, activeTeam, isTeamMember]);

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
        setActiveTeam,
        viewMode,
        switchViewMode,
        teamOwnerEmail
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
