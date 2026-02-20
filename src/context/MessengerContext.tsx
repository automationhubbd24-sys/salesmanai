import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { BACKEND_URL } from "@/config";

export interface MessengerPage {
  page_id: string;
  name: string;
  page_access_token?: string;
  db_id?: number;
  email?: string;
  created_at?: string;
}

export interface MessengerContextType {
  pages: MessengerPage[];
  currentPage: MessengerPage | null;
  setCurrentPage: (page: MessengerPage | null) => void;
  refreshPages: () => Promise<void>;
  loading: boolean;
  // Team Features
  isTeamMember: boolean;
  teams: { id: number; owner_email: string; permissions: any }[];
  activeTeam: { id: number; owner_email: string; permissions: any } | null;
  setActiveTeam: (team: { id: number; owner_email: string; permissions: any } | null) => void;
  viewMode: 'personal' | 'team';
  switchViewMode: (mode: 'personal' | 'team') => void;
}

const MessengerContext = createContext<MessengerContextType | undefined>(undefined);

export function MessengerProvider({ children }: { children: React.ReactNode }) {
  const [pages, setPages] = useState<MessengerPage[]>([]);
  const [currentPage, setCurrentPage] = useState<MessengerPage | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Team State
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [teams, setTeams] = useState<{ id: number; owner_email: string; permissions: any }[]>([]);
  const [activeTeam, setActiveTeam] = useState<{ id: number; owner_email: string; permissions: any } | null>(null);
  
  const [viewMode, setViewMode] = useState<'personal' | 'team'>(() => {
    return (localStorage.getItem('messenger_view_mode') as 'personal' | 'team') || 'personal';
  });

  const switchViewMode = (mode: 'personal' | 'team') => {
    setViewMode(mode);
    localStorage.setItem('messenger_view_mode', mode);
  };

  const refreshPages = React.useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setPages([]);
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
                 setTeams(myTeams);
                 setIsTeamMember(myTeams.length > 0);
                 
                 // Restore active team from local storage
                 const storedOwner = localStorage.getItem('active_team_owner');
                 if (storedOwner && !activeTeam) {
                     const found = myTeams.find((t: any) => t.owner_email === storedOwner);
                     if (found) setActiveTeam(found);
                 }

                 // If activeTeam is set but not in myTeams anymore, clear it
                 if (activeTeam) {
                     const stillMember = myTeams.find((t: any) => t.id === activeTeam.id);
                     if (!stillMember) setActiveTeam(null);
                 }
             }
        }
      } catch (err) {
        console.error("Failed to fetch teams", err);
      }

      const res = await fetch(`${BACKEND_URL}/api/messenger/pages`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('Failed to load Messenger pages');
      }

      const allPages = await res.json();
      const apiPages = (Array.isArray(allPages) ? allPages : []) as (MessengerPage & { is_shared?: boolean; id?: number })[];

      let mergedPages: MessengerPage[] = [];

      if (viewMode === 'team' && activeTeam && apiPages.length > 0) {
          let teamPages = apiPages.filter((p) => p.is_shared);

          const allowedIds = activeTeam.permissions?.fb_pages;
          if (Array.isArray(allowedIds) && allowedIds.length > 0) {
              const allowedStrings = allowedIds.map((id: any) => String(id));
              teamPages = teamPages.filter((p) => allowedStrings.includes(String(p.page_id)));
          }

          mergedPages = teamPages.map((p) => ({
              page_id: p.page_id,
              name: p.name,
              page_access_token: p.page_access_token,
              db_id: p.id,
              email: p.email,
              created_at: p.created_at,
          }));
      } else if (apiPages.length > 0) {
          const personalPages = apiPages.filter((p) => !p.is_shared);
          mergedPages = personalPages.map((p) => ({
              page_id: p.page_id,
              name: p.name,
              page_access_token: p.page_access_token,
              db_id: p.id,
              email: p.email,
              created_at: p.created_at,
          }));
      }

      setPages(mergedPages);
      
      // Auto-select logic
      const storedPageId = localStorage.getItem("active_fb_page_id");
      if (storedPageId) {
          const found = mergedPages.find(p => p.page_id === storedPageId);
          if (found) {
              setCurrentPage(found);
              // Ensure DB ID is up to date in storage
              if (found.db_id) {
                localStorage.setItem("active_fb_db_id", found.db_id.toString());
              }
          } else if (mergedPages.length > 0) {
              // If stored one is invalid/gone, select first
              updateActivePage(mergedPages[0]);
          }
      } else if (mergedPages.length > 0) {
          updateActivePage(mergedPages[0]);
      }

    } catch (error) {
      console.error("Failed to fetch messenger pages", error);
      toast.error("Failed to load Facebook pages");
    } finally {
      setLoading(false);
    }
  }, [viewMode, activeTeam]);

  const updateActivePage = (page: MessengerPage | null) => {
    setCurrentPage(page);
    if (page) {
      localStorage.setItem("active_fb_page_id", page.page_id);
      if (page.db_id) {
        localStorage.setItem("active_fb_db_id", page.db_id.toString());
      } else {
        localStorage.removeItem("active_fb_db_id");
      }
    } else {
      localStorage.removeItem("active_fb_page_id");
      localStorage.removeItem("active_fb_db_id");
    }
    // Dispatch events for other components
    window.dispatchEvent(new Event("storage")); 
    window.dispatchEvent(new Event("db-connection-changed"));
  };

  useEffect(() => {
    refreshPages();
  }, [refreshPages]);

  return (
    <MessengerContext.Provider value={{ 
        pages, 
        currentPage, 
        setCurrentPage: updateActivePage, 
        refreshPages, 
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
    </MessengerContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMessenger() {
  const context = useContext(MessengerContext);
  if (context === undefined) {
    throw new Error("useMessenger must be used within a MessengerProvider");
  }
  return context;
}
