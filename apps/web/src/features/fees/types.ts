export type FeeStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE';
export type InstStatus = 'PAID' | 'PARTIAL' | 'PENDING' | 'DUE_SOON' | 'OVERDUE';
export type PaymentMethod = 'Cash' | 'UPI' | 'Bank transfer' | 'Cheque' | 'Card';

/** every amount is integer paise; the server decides statuses, balances and allocations */
export interface FeeSummary {
  payable: number;
  paid: number;
  outstanding: number;
  overdue: number;
  status: FeeStatus;
  dueSoon: boolean;
}

export interface InstallmentRow {
  no: number;
  dueDate: string;
  payable: number;
  paid: number;
  pending: number;
  status: InstStatus;
  components: { label: string; amount: number }[];
}

export interface PaymentRow {
  id: string;
  receiptNo: string;
  date: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  classLabel: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  collectedBy: string;
  status: 'POSTED' | 'REVERSED';
  reversal?: { reason: string; by: string; date: string };
}

export interface ReceiptData extends PaymentRow {
  academicYear: string;
  lines: { installmentNo: number; dueDate: string; amount: number }[];
  previousBalance: number;
  remainingBalance: number;
}
