import { describe, expect, it } from 'vitest';
import { buildExpense, decide } from './pipeline.ts';
import type { ParsedSms } from './types.ts';

const base: ParsedSms = {
  kind: 'purchase', amount: 83.78, currency: 'SAR', sar_amount: null, merchant: 'نون', date: '2025-10-29',
  card_last4: '4321', card_type: 'credit', card_network: 'visa', bank: 'الراجحي', payment_method: 'online',
  country: 'sa', category: 'التسوق والمشتريات', is_device: false, renewal: null,
};

describe('decide', () => {
  it('expense kinds need an amount', () => {
    expect(decide(base)).toEqual({ action: 'expense' });
    expect(decide({ ...base, kind: 'withdrawal' })).toEqual({ action: 'expense' });
    expect(decide({ ...base, amount: null })).toEqual({ action: 'failed', reason: 'ما قدرت أقرأ المبلغ' });
  });

  it('ignores non-spending messages', () => {
    for (const kind of ['otp', 'declined', 'refund', 'deposit', 'transfer_in', 'transfer_out', 'info'] as const) {
      expect(decide({ ...base, kind }).action).toBe('ignore');
    }
  });

  it('renewals need a date; Hijri is converted exactly', () => {
    const r = decide({ ...base, kind: 'renewal', renewal: { kind: 'iqama', title: 'الإقامة', due_date: null, hijri_due: { year: 1447, month: 1, day: 1 }, person: null } });
    expect(r).toMatchObject({ action: 'renewal', renewal: { due_date: '2025-06-26' } });
    expect(decide({ ...base, kind: 'renewal', renewal: { kind: 'iqama', title: 'x', due_date: null, hijri_due: null, person: null } }).action).toBe('ignore');
  });
});

describe('buildExpense', () => {
  it('SAR amount in halalas, country upper-cased', () => {
    const r = buildExpense(base, { rate: null, cardId: 'c1' });
    expect(r).toEqual({ ok: true, expense: expect.objectContaining({ amount: 8378, country: 'SA', card_id: 'c1', original_currency: null }) });
  });

  it('foreign currency: prefers the SAR amount stated by the bank', () => {
    const r = buildExpense({ ...base, amount: 25, currency: 'USD', sar_amount: 93.9 }, { rate: 3.75, cardId: null });
    expect(r).toMatchObject({ ok: true, expense: { amount: 9390, original_amount: 2500, original_currency: 'USD', fx_rate: 3.756 } });
  });

  it('foreign currency: converts with today rate', () => {
    const r = buildExpense({ ...base, amount: 120, currency: 'TRY' }, { rate: 0.0891, cardId: null });
    expect(r).toMatchObject({ ok: true, expense: { amount: 1069, original_amount: 12000, fx_rate: 0.0891 } });
    expect(buildExpense({ ...base, amount: 120, currency: 'TRY' }, { rate: null, cardId: null }).ok).toBe(false);
  });
});
