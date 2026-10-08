import { isPaise, type Paise } from '@sfm/shared';
import { FinanceError } from './errors';

/** A payment must be a positive, safe integer number of paise. Zero and negative are rejected. */
export function validatePaymentAmount(amount: unknown): asserts amount is Paise {
  if (!isPaise(amount)) {
    throw new FinanceError('PAYMENT_AMOUNT_INVALID', 'Payment amount must be a whole number of paise.', {
      reason: 'NOT_INTEGER',
    });
  }
  if (amount === 0) {
    throw new FinanceError('PAYMENT_AMOUNT_INVALID', 'Payment amount cannot be zero.', { reason: 'ZERO' });
  }
  if (amount < 0) {
    throw new FinanceError('PAYMENT_AMOUNT_INVALID', 'Payment amount cannot be negative.', { reason: 'NEGATIVE' });
  }
}
