import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  sessionResponseSchema,
  type PublicUser,
  type SessionResponse,
} from "@habitquest/shared";
import { api, HttpError, messageOf, setCsrfToken } from "@/lib/api";
type AuthState = {
  user: PublicUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  accept: (session: SessionResponse) => void;
  setUser: (user: PublicUser) => void;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accept = useCallback((session: SessionResponse) => {
    setCsrfToken(session.csrfToken);
    setUser(session.user);
    setError(null);
  }, []);
  const loadSession = useCallback(
    (signal?: AbortSignal) =>
      api("/auth/me", { signal })
        .then((result) => {
          if (!signal?.aborted) accept(sessionResponseSchema.parse(result));
        })
        .catch((error) => {
          if (signal?.aborted) return;
          if (error instanceof HttpError && error.status === 401) {
            setUser(null);
            setCsrfToken(null);
          } else setError(messageOf(error));
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [accept],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal);
    const expired = () => {
      setUser(null);
      setCsrfToken(null);
    };
    window.addEventListener("habitquest:unauthenticated", expired);
    return () => {
      controller.abort();
      window.removeEventListener("habitquest:unauthenticated", expired);
    };
  }, [loadSession]);
  const refresh = async () => {
    setLoading(true);
    setError(null);
    await loadSession();
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setCsrfToken(null);
  };
  return (
    <AuthContext.Provider
      value={{ user, loading, error, refresh, accept, setUser, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider missing");
  return context;
}
