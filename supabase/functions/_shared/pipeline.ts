// قرارات معالجة الرسالة بعد قراءتها (منطق خالص قابل للاختبار)

import { hijriToGregorian } from './hijri.ts';
import { clean } from './text.ts';
import { EXPENSE_KINDS, type ParsedRenewal, type ParsedSms } from './types.ts';

export type Decision =
  | { action: 'expense' }
  | { action: 'renewal'; renewal: ParsedRenewal & { due_date: string } }
  | { action: 'ignore'; reason: string }
  | { action: 'failed'; reason: string };

const IGNORE_REASON: Partial<Record<ParsedSms['kind'], string>> = {
  otp: 'رمز تحقق',
  declined: 'عملية مرفوضة',
  refund: 'مبلغ مسترد',
  deposit: 'مبلغ وارد',
  transfer_in: 'حوالة واردة',
  transfer_out: 'حوالة صادرة — أضفها يدوياً إذا كانت مصروفاً',
  info: 'ليست عملية مالية',
};

/** تاريخ التجديد الميلادي من الحقلين (الهجري يُحوَّل هنا وليس بالتخمين) */
export function renewalDueDate(r: ParsedRenewal | null): string | null {
  if (!r) return null;
  if (r.hijri_due) return hijriToGregorian(r.hijri_due.year, r.hijri_due.month, r.hijri_due.day);
  return r.due_date && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) ? r.due_date : null;
}

export function decide(p: ParsedSms): Decision {
  if (p.kind === 'renewal') {
    const due = renewalDueDate(p.renewal);
    return p.renewal && due ? { action: 'renewal', renewal: { ...p.renewal, due_date: due } }
      : { action: 'ignore', reason: 'تنبيه بدون تاريخ' };
  }
  if (!EXPENSE_KINDS.includes(p.kind)) return { action: 'ignore', reason: IGNORE_REASON[p.kind] ?? 'ليست عملية شراء' };
  if (!(typeof p.amount === 'number' && p.amount > 0 && p.amount < 10_000_000)) {
    return { action: 'failed', reason: 'ما قدرت أقرأ المبلغ' };
  }
  return { action: 'expense' };
}

export interface ExpenseFields {
  amount: number;            // بالهللة (قبل رسوم البطاقة، تضيفها قاعدة البيانات)
  merchant: string | null;
  expense_date: string | null;
  payment_method: string | null;
  bank: string | null;
  country: string | null;
  card_id: string | null;
  original_amount: number | null;
  original_currency: string | null;
  fx_rate: number | null;
  category_name: string | null;
}

/** يحوّل القراءة إلى حقول العملية. rate = ريال لكل وحدة من العملة الأجنبية (بسعر اليوم). */
export function buildExpense(p: ParsedSms, opts: { rate: number | null; cardId: string | null }):
  { ok: true; expense: ExpenseFields } | { ok: false; reason: string } {
  const currency = (p.currency ?? 'SAR').toUpperCase();
  const amount = p.amount!;
  let halalas: number;
  let original: number | null = null;
  let fx: number | null = null;

  if (currency === 'SAR' || !/^[A-Z]{3}$/.test(currency)) {
    halalas = Math.round(amount * 100);
  } else {
    original = Math.round(amount * 100);
    if (p.sar_amount && p.sar_amount > 0) {
      halalas = Math.round(p.sar_amount * 100);
      fx = Number((p.sar_amount / amount).toFixed(8));
    } else if (opts.rate) {
      halalas = Math.round(amount * opts.rate * 100);
      fx = Number(opts.rate.toFixed(8));
    } else {
      return { ok: false, reason: `ما قدرت أجيب سعر ${currency}` };
    }
  }
  if (!(halalas > 0)) return { ok: false, reason: 'مبلغ صفر' };

  return {
    ok: true,
    expense: {
      amount: halalas,
      merchant: clean(p.merchant, 80),
      expense_date: p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null,
      payment_method: p.payment_method,
      bank: clean(p.bank, 40),
      country: p.country && /^[A-Za-z]{2}$/.test(p.country) ? p.country.toUpperCase() : null,
      card_id: opts.cardId,
      original_amount: original,
      original_currency: original ? currency : null,
      fx_rate: fx,
      category_name: p.category,
    },
  };
}
