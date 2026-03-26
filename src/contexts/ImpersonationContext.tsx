import { createContext, useContext, useState, type ReactNode } from "react";

export interface ImpersonatedUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

interface ImpersonationContextType {
  impersonating: ImpersonatedUser | null;
  startImpersonation: (user: ImpersonatedUser) => void;
  stopImpersonation: () => void;
}

const ImpersonationContext = createContext<ImpersonationContextType>({
  impersonating: null,
  startImpersonation: () => {},
  stopImpersonation: () => {},
});

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [impersonating, setImpersonating] = useState<ImpersonatedUser | null>(null);

  return (
    <ImpersonationContext.Provider
      value={{
        impersonating,
        startImpersonation: setImpersonating,
        stopImpersonation: () => setImpersonating(null),
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
