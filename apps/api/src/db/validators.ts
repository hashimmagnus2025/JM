/**
 * MongoDB collection validators ($expr). They re-state the finance invariants IN THE DATABASE, so even a
 * buggy service or a manual script cannot persist a receivable/payment/allocation that breaks the arithmetic.
 * Applied by migration 001 (createCollection / collMod) and unit-tested with `mingo`.
 */

const sumOf = (path: string) => ({ $sum: path });

export const RECEIVABLE_VALIDATOR = {
  $expr: {
    $and: [
      { $gte: ['$payable', 0] },
      { $gte: ['$adjusted', 0] },
      { $gte: ['$transferred', 0] },
      { $gte: ['$paid', 0] },
      { $gte: ['$pending', 0] },
      // pending is ALWAYS payable − adjusted − transferred − paid
      {
        $eq: [
          '$pending',
          { $subtract: ['$payable', { $add: ['$adjusted', '$transferred', '$paid'] }] },
        ],
      },
      // aggregates equal the sum of the components
      { $eq: ['$payable', sumOf('$components.payable')] },
      { $eq: ['$adjusted', sumOf('$components.adjusted')] },
      { $eq: ['$transferred', sumOf('$components.transferred')] },
      { $eq: ['$paid', sumOf('$components.paid')] },
      // no component may be over-paid / over-adjusted
      {
        $allElementsTrue: [
          {
            $map: {
              input: '$components',
              as: 'c',
              in: {
                $gte: [
                  {
                    $subtract: [
                      '$$c.payable',
                      { $add: ['$$c.adjusted', '$$c.transferred', '$$c.paid'] },
                    ],
                  },
                  0,
                ],
              },
            },
          },
        ],
      },
    ],
  },
};

export const PAYMENT_VALIDATOR = {
  $expr: {
    $and: [
      { $gt: ['$amount', 0] },
      { $gte: ['$allocatedAmount', 0] },
      { $gte: ['$unallocatedAmount', 0] },
      { $eq: ['$amount', { $add: ['$allocatedAmount', '$unallocatedAmount'] }] },
    ],
  },
};

export const ALLOCATION_VALIDATOR = {
  $expr: {
    $and: [
      { $ne: ['$amount', 0] },
      // payments are positive rows, reversals are negative rows
      {
        $cond: [{ $eq: ['$kind', 'ALLOCATION'] }, { $gt: ['$amount', 0] }, { $lt: ['$amount', 0] }],
      },
      { $eq: ['$amount', sumOf('$componentSplit.amount')] },
    ],
  },
};

export const OPENING_BALANCE_VALIDATOR = { $expr: { $gt: ['$amount', 0] } };

/** collection → validator applied by the migration */
export const COLLECTION_VALIDATORS: Record<string, Record<string, unknown>> = {
  receivables: RECEIVABLE_VALIDATOR,
  payments: PAYMENT_VALIDATOR,
  payment_allocations: ALLOCATION_VALIDATOR,
  opening_balances: OPENING_BALANCE_VALIDATOR,
};
