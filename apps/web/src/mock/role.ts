import { create } from 'zustand';

const KEY = 'mock-role';
const read = (): string => {
  try {
    return sessionStorage.getItem(KEY) ?? 'SUPER_ADMIN';
  } catch {
    return 'SUPER_ADMIN';
  }
};

/** which built-in role the mock session is signed in as (switched from the toolbar in mock mode; survives a reload) */
export const useMockRole = create<{ role: string; setRole: (r: string) => void }>((set) => ({
  role: read(),
  setRole: (role) => {
    try {
      sessionStorage.setItem(KEY, role);
    } catch {
      /* storage blocked: the role simply resets on reload */
    }
    set({ role });
  },
}));
