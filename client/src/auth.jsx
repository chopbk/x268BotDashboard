import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    api("/api/auth/me", { signal: controller.signal })
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      async login(identifier, password) {
        const me = await api("/api/auth/login", {
          method: "POST",
          body: { identifier, password },
        });
        setUser(me);
        return me;
      },
      async register(name, username, email, password) {
        const me = await api("/api/auth/register", {
          method: "POST",
          body: { name, username, email, password },
        });
        setUser(me);
        return me;
      },
      async logout() {
        await api("/api/auth/logout", { method: "POST" });
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
