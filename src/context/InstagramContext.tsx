import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { BACKEND_URL } from "@/config";

export interface InstagramAccount {
  page_id: string;
  name: string;
  db_id?: number;
  id?: number;
}

interface InstagramContextType {
  accounts: InstagramAccount[];
  currentAccount: InstagramAccount | null;
  setCurrentAccount: (account: InstagramAccount | null) => void;
  refreshAccounts: () => Promise<void>;
  loading: boolean;
}

const InstagramContext = createContext<InstagramContextType | undefined>(undefined);

export function InstagramProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [currentAccount, setCurrentAccountState] = useState<InstagramAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const currentAccountRef = useRef<InstagramAccount | null>(null);

  const setCurrentAccount = useCallback((account: InstagramAccount | null) => {
    currentAccountRef.current = account;
    setCurrentAccountState(account);

    if (account) {
      localStorage.setItem("active_ig_account_id", account.page_id);
      localStorage.setItem("active_ig_db_id", String(account.db_id || account.id || ""));
    } else {
      localStorage.removeItem("active_ig_account_id");
      localStorage.removeItem("active_ig_db_id");
    }

    window.dispatchEvent(new Event("instagram-account-changed"));
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("db-connection-changed"));
  }, []);

  const refreshAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setAccounts([]);
        setCurrentAccount(null);
        return;
      }

      const response = await fetch(`${BACKEND_URL}/api/instagram/pages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;

      const data = await response.json();
      const nextAccounts: InstagramAccount[] = Array.isArray(data) ? data : [];
      setAccounts(nextAccounts);

      const storedAccountId = localStorage.getItem("active_ig_account_id");
      const selectedAccount = nextAccounts.find((account) => account.page_id === storedAccountId)
        || nextAccounts.find((account) => account.page_id === currentAccountRef.current?.page_id)
        || nextAccounts[0]
        || null;

      if (selectedAccount) {
        setCurrentAccount(selectedAccount);
      } else if (currentAccountRef.current) {
        setCurrentAccount(null);
      }
    } finally {
      setLoading(false);
    }
  }, [setCurrentAccount]);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  return (
    <InstagramContext.Provider value={{ accounts, currentAccount, setCurrentAccount, refreshAccounts, loading }}>
      {children}
    </InstagramContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInstagram() {
  const context = useContext(InstagramContext);
  if (!context) {
    throw new Error("useInstagram must be used within an InstagramProvider");
  }
  return context;
}
