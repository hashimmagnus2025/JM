/**
 * Screens whose backend is not built yet (students, fees, payments, receivables, reports …) are visible only in mock mode
 * (`npm run dev:mock`) or when VITE_FINANCE_UI=true. When the backend for them is ready this switches on by default.
 */
export const MOCK_MODE: boolean = import.meta.env.MODE === 'mock';
export const FINANCE_UI: boolean = MOCK_MODE || import.meta.env.VITE_FINANCE_UI === 'true';
