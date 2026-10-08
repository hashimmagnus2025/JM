export type FinanceErrorCode =
  | 'PAYMENT_AMOUNT_INVALID'
  | 'PAYMENT_EXCEEDS_OUTSTANDING'
  | 'NO_PAYABLE_RECEIVABLES'
  | 'ALLOCATION_INVALID'
  | 'ALLOCATION_INCOMPLETE'
  | 'ADJUSTMENT_AMOUNT_INVALID'
  | 'ADJUSTMENT_EXCEEDS_PAYABLE'
  | 'ADJUSTMENT_INVALID'
  | 'INSTALLMENT_PLAN_INVALID'
  | 'COMPONENT_SCHEDULE_MISMATCH'
  | 'FEE_LINES_INVALID'
  | 'NO_FEE_STRUCTURE'
  | 'FEE_VERSION_IMMUTABLE'
  | 'OPENING_BALANCE_INVALID'
  | 'OPENING_BALANCE_DUPLICATE'
  | 'CARRY_FORWARD_INVALID'
  | 'LATE_FEE_POLICY_INVALID'
  | 'PAYMENT_ALREADY_REVERSED'
  | 'REVERSAL_REASON_REQUIRED'
  | 'REVERSAL_APPROVER_INVALID'
  | 'RECEIPT_NUMBER_INVALID'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVARIANT_VIOLATION';

/** Domain rule violation. Services map these to HTTP 422 with the same stable `code`. */
export class FinanceError extends Error {
  constructor(
    public readonly code: FinanceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FinanceError';
  }
}
