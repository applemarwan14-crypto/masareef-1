/** كل المبالغ في التطبيق بالهللة (عدد صحيح). 1 ريال = 100 هللة. */
export type Halalas = number;
/** تاريخ بصيغة YYYY-MM-DD */
export type ISODate = string;
/** بداية شهر بصيغة YYYY-MM-01 */
export type MonthKey = string;

export interface Household {
  id: string;
  name: string;
  currency: string;
  monthly_budget: Halalas | null;
  invite_code: string;
  salary_day: number;
}

export interface Member {
  household_id: string;
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_archived: boolean;
  is_pinned: boolean;
}

export type ExpenseSource = 'manual' | 'sms' | 'recurring';
export type PaymentMethod = 'mada' | 'apple_pay' | 'pos' | 'online' | 'atm' | 'sadad' | 'transfer' | 'other';

export interface Expense {
  id: string;
  household_id: string;
  category_id: string;
  amount: Halalas;
  expense_date: ISODate;
  description: string | null;
  receipt_path: string | null;
  recurring_id: string | null;
  recurring_period: MonthKey | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  merchant: string | null;
  source: ExpenseSource;
  payment_method: PaymentMethod | null;
  bank: string | null;
  country: string | null;
  card_id: string | null;
  /** المبلغ بعملته الأصلية ×100 */
  original_amount: number | null;
  original_currency: string | null;
  fx_rate: number | null;
  fee_amount: Halalas | null;
  trip_id: string | null;
}

export interface Recurring {
  id: string;
  household_id: string;
  category_id: string;
  name: string;
  amount: Halalas;
  day_of_month: number;
  start_month: MonthKey;
  is_active: boolean;
}

export interface MonthlyTotal {
  month: MonthKey;
  category_id: string;
  total: Halalas;
  tx_count: number;
}

export type CardType = 'credit' | 'debit' | 'mada' | 'prepaid' | 'other';

export interface Card {
  id: string;
  household_id: string;
  user_id: string | null;
  bank: string;
  last4: string;
  card_type: CardType;
  network: 'visa' | 'mastercard' | 'mada' | 'amex' | 'other' | null;
  nickname: string | null;
  /** نقاط أساس: 275 = 2.75% */
  intl_fee_bps: number;
}

export interface Trip {
  id: string;
  household_id: string;
  name: string;
  countries: string[];
  started_on: ISODate;
  last_foreign_on: ISODate | null;
  ended_on: ISODate | null;
  status: 'open' | 'closed';
  budget: Halalas | null;
  auto: boolean;
  closed_reason: string | null;
  archived_total: Halalas | null;
}

export type RenewalKind =
  | 'insurance' | 'istimara' | 'license' | 'passport' | 'iqama' | 'national_id'
  | 'subscription' | 'rent' | 'warranty' | 'other';

export interface Renewal {
  id: string;
  household_id: string;
  kind: RenewalKind;
  title: string;
  due_date: ISODate;
  amount: Halalas | null;
  remind_days: number;
  person: string | null;
  notes: string | null;
  source: 'manual' | 'sms' | 'auto' | 'text';
  expense_id: string | null;
  status: 'active' | 'done' | 'dismissed';
}

export type NotificationKind =
  | 'sms_added' | 'family_expense' | 'budget' | 'recurring_due' | 'month_summary'
  | 'sms_failed' | 'trip' | 'renewal' | 'duplicate' | 'daily' | 'test';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: { url?: string; expense_id?: string } & Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export interface SmsMessage {
  id: string;
  body: string;
  status: 'added' | 'ignored' | 'failed' | 'renewal';
  reason: string | null;
  parser: 'claude' | 'local' | null;
  parsed: Record<string, unknown> | null;
  expense_id: string | null;
  created_at: string;
}

export interface CategorySnapshot {
  id: string;
  summary: string | null;
  stats: { created: number; renamed: number; merged: number; moved: number } | null;
  created_at: string;
  undone_at: string | null;
}

export interface OrganizePlan {
  summary: string;
  changes: string[];
  creates: { key: string; name: string; icon: string; color: string }[];
  renames: { id: string; name: string }[];
  merges: { from: string; to: string }[];
  moves: { expense_id: string; to: string }[];
  order: string[];
}

export interface InsightNotes {
  headline: string;
  notes: { title: string; body: string; tone: 'good' | 'warn' | 'tip' }[];
}

export interface YearRow {
  year: number;
  total: Halalas;
  tx_count: number;
  months: number;
  archived: boolean;
}
