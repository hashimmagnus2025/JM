import { create } from 'zustand';
import {
  get,
  login,
  logout,
  refreshSession,
  setAccessToken,
  setSessionLostHandler,
} from '../../lib/api';

export interface Principal {
  id: string;
  name: string;
  email: string;
  roleKeys: string[];
  permissions: string[];
  dataScope: 'ALL' | 'OWN_DIVISIONS';
  mustChangePassword: boolean;
}

type Status = 'booting' | 'anon' | 'authed';

interface AuthState {
  status: Status;
  principal: Principal | null;
  set: (status: Status, principal: Principal | null) => void;
}

/** the ONLY global client state besides UI preferences: who is signed in (never tokens — those stay in memory in the api client) */
export const useAuth = create<AuthState>((set) => ({
  status: 'booting',
  principal: null,
  set: (status, principal) => set({ status, principal }),
}));

const loadMe = (): Promise<Principal> => get<Principal>('/auth/me');

/** on page load: if the refresh cookie is still valid the user is signed in without typing anything */
export async function bootSession(): Promise<void> {
  setSessionLostHandler(() => {
    setAccessToken(null);
    useAuth.getState().set('anon', null);
  });
  if (!(await refreshSession())) {
    useAuth.getState().set('anon', null);
    return;
  }
  try {
    useAuth.getState().set('authed', await loadMe());
  } catch {
    useAuth.getState().set('anon', null);
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  await login(email, password);
  useAuth.getState().set('authed', await loadMe());
}

/** after a password change the server issues a fresh session */
export async function reloadPrincipal(): Promise<void> {
  useAuth.getState().set('authed', await loadMe());
}

export async function signOut(): Promise<void> {
  await logout();
  useAuth.getState().set('anon', null);
}

/** UI-only convenience: the backend re-checks every permission on every request */
export function usePermission(permission: string): boolean {
  return useAuth((s) => s.principal?.permissions.includes(permission) ?? false);
}

export function useCan(): (permission: string) => boolean {
  const perms = useAuth((s) => s.principal?.permissions);
  return (p) => perms?.includes(p) ?? false;
}
