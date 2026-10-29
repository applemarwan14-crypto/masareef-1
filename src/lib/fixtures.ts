// بيانات وهمية للاختبارات فقط
import type { Category, Expense } from './types';

export const makeCategory = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
  id, household_id: 'h', name, icon: 'circle', color: '#000000', sort_order: 0, is_archived: false, is_pinned: false, ...extra,
});

export const makeExpense = (
  id: string, category_id: string, amount: number, expense_date: string, extra: Partial<Expense> = {},
): Expense => ({
  id, household_id: 'h', category_id, amount, expense_date, description: null, receipt_path: null,
  recurring_id: null, recurring_period: null, created_by: 'u1', created_at: '', updated_at: '',
  merchant: null, source: 'manual', payment_method: null, bank: null, country: null, card_id: null,
  original_amount: null, original_currency: null, fx_rate: null, fee_amount: 0, trip_id: null, ...extra,
});
