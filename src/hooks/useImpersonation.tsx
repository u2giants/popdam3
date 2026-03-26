import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type ImpersonatedRole = "member" | null;

interface ImpersonationContextValue {
  impersonatedRole: ImpersonatedRole;
  startImpersonating: (role: "member") => void;
  stopImpersonating: () => void;
}

const ImpersonationContext = createContext<ImpersonationContextValue>({
  impersonatedRole: null,
  startImpersonating: () => {},
  stopImpersonating: () => {},
});

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [impersonatedRole, setRole] = useState<ImpersonatedRole>(() => {
    const stored = sessionStorage.getItem("popdam_impersonate");
    return stored === "member" ? "member" : null;
  });

  const startImpersonating = useCallback((role: "member") => {
    sessionStorage.setItem("popdam_impersonate", role);
    setRole(role);
  }, []);

  const stopImpersonating = useCallback(() => {
    sessionStorage.removeItem("popdam_impersonate");
    setRole(null);
  }, []);

  return (
    <ImpersonationContext.Provider value={{ impersonatedRole, startImpersonating, stopImpersonating }}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
