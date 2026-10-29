import { supabase } from './supabase';
import type {
  AppNotification, Card, Category, CategorySnapshot, Expense, Household, InsightNotes, ISODate, Member, MonthKey,
  MonthlyTotal, OrganizePlan, Recurring, Renewal, SmsMessage, StatementImport, StatementRow, Trip, YearRow,
} from './types';

/** يرمي خطأ مقروءاً بالعربية عند فشل الطلب */
function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(translateError(res.error.message, res.error.code));
  return res.data;
}

export function translateError(message: string, code?: string): string {
  if (code === '23505') return 'هذه العملية مسجلة مسبقاً';
  if (code === '23503') return 'لا يمكن الحذف لوجود عمليات مرتبطة. يمكنك أرشفته بدلاً من ذلك';
  if (/invalid invite code/i.test(message)) return 'رمز الدعوة غير صحيح';
  if (/already in a household/i.test(message)) return 'حسابك مرتبط بعائلة بالفعل';
  if (/household is full/i.test(message)) return 'العائلة مكتملة العدد';
  if (/Invalid login credentials/i.test(message)) return 'البريد أو كلمة المرور غير صحيحة';
  if (/User already registered/i.test(message)) return 'هذا البريد مسجل مسبقاً، سجّل الدخول بدلاً من ذلك';
  if (/Password should be/i.test(message)) return 'كلمة المرور قصيرة، استخدم 8 أحرف على الأقل';
  if (/Email not confirmed/i.test(message)) return 'أكّد بريدك الإلكتروني أولاً من الرسالة المرسلة إليك';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'تعذّر الاتصال بالخادم، تحقق من الإنترنت';
  if (/only the owner/i.test(message) || code === '42501') return 'هذا الإجراء لمنشئ العائلة فقط';
  if (/pinned category/i.test(message)) return 'هذا تصنيف أساسي مثبّت، لا يُحذف ولا يُؤرشف';
  if (/undo the newer/i.test(message)) return 'تراجع عن التنظيم الأحدث أولاً';
  if (/only finished years/i.test(message)) return 'تُؤرشف السنوات المنتهية فقط';
  if (/nothing to archive/i.test(message)) return 'لا توجد عمليات في هذه السنة';
  if (/no rule for this merchant/i.test(message)) return 'لا توجد قاعدة لهذا المتجر بعد';
  if (/warranty is for purchases/i.test(message)) return 'الضمان للمشتريات من 300 ر.س فأكثر';
  return message;
}

// ---------- العائلة ----------
export interface HouseholdContext {
  household: Household;
  me: Member;
  members: Member[];
}

export async function fetchHouseholdContext(userId: string): Promise<HouseholdContext | null> {
  const mine = check(
    await supabase.from('household_members').select('*').eq('user_id', userId).maybeSingle<Member>(),
  );
  if (!mine) return null;
  const [household, members] = await Promise.all([
    supabase.from('households').select('*').eq('id', mine.household_id).single<Household>().then(check),
    supabase.from('household_members').select('*').eq('household_id', mine.household_id).order('joined_at').then(check),
  ]);
  return { household: household as Household, me: mine, members: members as Member[] };
}

export const createHousehold = async (name: string, displayName: string) =>
  check(await supabase.rpc('create_household', { p_name: name, p_display_name: displayName })) as string;

export const joinHousehold = async (code: string, displayName: string) =>
  check(await supabase.rpc('join_household', { p_code: code, p_display_name: displayName })) as string;

export const regenerateInviteCode = async () => check(await supabase.rpc('regenerate_invite_code')) as string;

export async function updateHousehold(id: string, patch: Partial<Pick<Household, 'name' | 'monthly_budget' | 'salary_day'>>) {
  check(await supabase.from('households').update(patch).eq('id', id));
}

export async function updateDisplayName(householdId: string, userId: string, displayName: string) {
  check(
    await supabase.from('household_members').update({ display_name: displayName })
      .eq('household_id', householdId).eq('user_id', userId),
  );
}

// ---------- التصنيفات ----------
export const fetchCategories = async (householdId: string) =>
  check(
    await supabase.from('categories').select('*').eq('household_id', householdId).order('sort_order').order('name'),
  ) as Category[];

export type CategoryInput = Pick<Category, 'name' | 'icon' | 'color'> & Partial<Pick<Category, 'is_archived' | 'sort_order'>>;

export async function saveCategory(householdId: string, input: CategoryInput, id?: string) {
  if (id) check(await supabase.from('categories').update(input).eq('id', id));
  else check(await supabase.from('categories').insert({ ...input, household_id: householdId }));
}

export const deleteCategory = async (id: string) => check(await supabase.from('categories').delete().eq('id', id));

// ---------- المصروفات ----------
// نص واحد (وليس مجموع نصوص) حتى يفهم supabase-js الأعمدة
const EXPENSE_COLUMNS =
  'id,household_id,category_id,amount,expense_date,description,receipt_path,recurring_id,recurring_period,created_by,created_at,updated_at,merchant,source,payment_method,bank,country,card_id,original_amount,original_currency,fx_rate,fee_amount,trip_id';

export const fetchExpenses = async (householdId: string, from: ISODate, to: ISODate) =>
  check(
    await supabase.from('expenses').select(EXPENSE_COLUMNS).eq('household_id', householdId)
      .gte('expense_date', from).lte('expense_date', to)
      .order('expense_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(5000),
  ) as Expense[];

export const fetchRecurringPayments = async (householdId: string, month: MonthKey) =>
  check(
    await supabase.from('expenses').select(EXPENSE_COLUMNS).eq('household_id', householdId)
      .eq('recurring_period', month).not('recurring_id', 'is', null),
  ) as Expense[];

export const fetchMonthlyTotals = async (householdId: string, fromMonth: MonthKey) =>
  check(
    await supabase.from('monthly_category_totals').select('month,category_id,total,tx_count')
      .eq('household_id', householdId).gte('month', fromMonth),
  ) as MonthlyTotal[];

export interface ExpenseInput {
  amount: number;
  category_id: string;
  expense_date: ISODate;
  description: string | null;
  merchant?: string | null;
  card_id?: string | null;
  trip_id?: string | null;
  original_amount?: number | null;
  original_currency?: string | null;
  fx_rate?: number | null;
}

export async function saveExpense(
  householdId: string,
  input: ExpenseInput,
  options: { id?: string; receipt?: File | null } = {},
): Promise<Expense> {
  const query = options.id
    ? supabase.from('expenses').update(input).eq('id', options.id)
    : supabase.from('expenses').insert({ ...input, household_id: householdId });
  const saved = check(await query.select(EXPENSE_COLUMNS).single()) as Expense;

  if (options.receipt) {
    const path = await uploadReceipt(householdId, saved.id, options.receipt);
    const updated = check(
      await supabase.from('expenses').update({ receipt_path: path }).eq('id', saved.id).select(EXPENSE_COLUMNS).single(),
    ) as Expense;
    if (saved.receipt_path) await supabase.storage.from('receipts').remove([saved.receipt_path]);
    return updated;
  }
  return saved;
}

export async function deleteExpense(expense: Pick<Expense, 'id' | 'receipt_path'>) {
  check(await supabase.from('expenses').delete().eq('id', expense.id));
  if (expense.receipt_path) await supabase.storage.from('receipts').remove([expense.receipt_path]);
}

// ---------- الفواتير ----------
async function uploadReceipt(householdId: string, expenseId: string, file: File): Promise<string> {
  let body: File | Blob = file;
  let ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  if (file.type.startsWith('image/') && file.type !== 'image/heic') {
    // ضغط صور الجوال الكبيرة قبل الرفع (أسرع وأوفر)
    const { default: imageCompression } = await import('browser-image-compression'); // تحميل عند الحاجة
    body = await imageCompression(file, { maxSizeMB: 0.8, maxWidthOrHeight: 1800, useWebWorker: true, fileType: 'image/webp' });
    ext = 'webp';
  }
  const path = `${householdId}/${expenseId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('receipts').upload(path, body, {
    contentType: body.type || file.type, upsert: false,
  });
  if (error) throw new Error(`تم حفظ المصروف لكن تعذّر رفع الفاتورة: ${error.message}`);
  return path;
}

export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ---------- المتكررة ----------
export const fetchRecurring = async (householdId: string) =>
  check(
    await supabase.from('recurring_expenses')
      .select('id,household_id,category_id,name,amount,day_of_month,start_month,is_active')
      .eq('household_id', householdId).order('day_of_month'),
  ) as Recurring[];

export type RecurringInput = Pick<Recurring, 'name' | 'amount' | 'category_id' | 'day_of_month' | 'is_active'>;

export async function saveRecurring(householdId: string, input: RecurringInput, id?: string) {
  if (id) check(await supabase.from('recurring_expenses').update(input).eq('id', id));
  else check(await supabase.from('recurring_expenses').insert({ ...input, household_id: householdId }));
}

export const deleteRecurring = async (id: string) =>
  check(await supabase.from('recurring_expenses').delete().eq('id', id));

export const markRecurringPaid = async (recurringId: string, period: MonthKey, date: ISODate) =>
  check(await supabase.rpc('mark_recurring_paid', { p_recurring_id: recurringId, p_period: period, p_date: date })) as string;

// ---------- رسائل البنك ----------
export const fetchSmsMessages = async (limit = 100) =>
  check(
    await supabase.from('sms_messages').select('id,body,status,reason,parser,parsed,expense_id,created_at')
      .order('created_at', { ascending: false }).limit(limit),
  ) as SmsMessage[];

export const deleteSmsMessage = async (id: string) => check(await supabase.from('sms_messages').delete().eq('id', id));
export const mySmsToken = async () => check(await supabase.rpc('my_sms_token')) as string | null;
export const regenerateSmsToken = async () => check(await supabase.rpc('regenerate_sms_token')) as string;
export const applyRuleToPast = async (merchant: string) =>
  check(await supabase.rpc('apply_rule_to_past', { p_merchant: merchant })) as number;

// ---------- تنظيم التصنيفات ----------
export const applyCategoryPlan = async (plan: OrganizePlan) =>
  check(await supabase.rpc('apply_category_plan', { p_plan: plan })) as string;
export const undoCategoryPlan = async (id: string) => check(await supabase.rpc('undo_category_plan', { p_snapshot: id }));
export const fetchSnapshots = async (householdId: string) =>
  check(
    await supabase.from('category_snapshots').select('id,summary,stats,created_at,undone_at')
      .eq('household_id', householdId).order('created_at', { ascending: false }).limit(5),
  ) as CategorySnapshot[];

// ---------- دوال Claude على الخادم ----------
export async function callAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai', { body });
  if (error) {
    // نص الخطأ القادم من الدالة إن وُجد
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg ?? translateError(error.message));
  }
  return data as T;
}
export const suggestOrganize = () => callAi<OrganizePlan>({ action: 'organize' });
export const fetchInsightNotes = (month: MonthKey, facts: unknown, refresh = false) =>
  callAi<InsightNotes>({ action: 'insights', month, facts, refresh });
export const fxRate = (currency: string) => callAi<{ currency: string; rate: number; date: ISODate }>({ action: 'fx', currency });
export interface ParsedRenewalText {
  kind: Renewal['kind']; title: string; due_date: ISODate | null; person: string | null; amount: number | null; notes: string | null;
  hijri: { year: number; month: number; day: number } | null;
}
export const parseRenewalText = (text: string) => callAi<ParsedRenewalText>({ action: 'renewal_parse', text });

// ---------- البطاقات ----------
export const fetchCards = async (householdId: string) =>
  check(await supabase.from('cards').select('*').eq('household_id', householdId).order('created_at')) as Card[];
export type CardInput = Pick<Card, 'bank' | 'last4' | 'card_type' | 'nickname' | 'intl_fee_bps'> & Partial<Pick<Card, 'user_id' | 'network'>>;
export async function saveCard(householdId: string, input: CardInput, id?: string) {
  if (id) check(await supabase.from('cards').update(input).eq('id', id));
  else check(await supabase.from('cards').insert({ ...input, household_id: householdId }));
}
export const deleteCard = async (id: string) => check(await supabase.from('cards').delete().eq('id', id));

// ---------- الرحلات ----------
export const fetchTrips = async (householdId: string) =>
  check(await supabase.from('trips').select('*').eq('household_id', householdId).order('started_on', { ascending: false })) as Trip[];
export const fetchTripExpenses = async (tripId: string) =>
  check(
    await supabase.from('expenses').select(EXPENSE_COLUMNS).eq('trip_id', tripId)
      .order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
  ) as Expense[];
export type TripInput = Partial<Pick<Trip, 'name' | 'budget' | 'status' | 'ended_on' | 'started_on' | 'auto'>>;
export async function saveTrip(householdId: string, input: TripInput, id?: string) {
  if (id) return check(await supabase.from('trips').update(input).eq('id', id).select('*').single()) as Trip;
  return check(await supabase.from('trips').insert({ ...input, household_id: householdId, auto: false }).select('*').single()) as Trip;
}
export const deleteTrip = async (id: string) => check(await supabase.from('trips').delete().eq('id', id));
export const reopenTrip = async (id: string) => check(await supabase.rpc('reopen_trip', { p_trip: id }));

// ---------- التجديدات ----------
export const fetchRenewals = async (householdId: string) =>
  check(await supabase.from('renewals').select('*').eq('household_id', householdId).order('due_date')) as Renewal[];
export type RenewalInput = Pick<Renewal, 'kind' | 'title' | 'due_date'> &
  Partial<Pick<Renewal, 'amount' | 'person' | 'notes' | 'status' | 'source' | 'remind_days'>>;
export async function saveRenewal(householdId: string, input: RenewalInput, id?: string) {
  if (id) check(await supabase.from('renewals').update(input).eq('id', id));
  else check(await supabase.from('renewals').insert({ ...input, household_id: householdId }));
}
export const deleteRenewal = async (id: string) => check(await supabase.from('renewals').delete().eq('id', id));
export const addWarranty = async (expenseId: string) => check(await supabase.rpc('add_warranty', { p_expense: expenseId }));

// ---------- الإشعارات ----------
export const fetchNotifications = async (limit = 60) =>
  check(
    await supabase.from('notifications').select('id,kind,title,body,data,created_at,read_at')
      .order('created_at', { ascending: false }).limit(limit),
  ) as AppNotification[];
export const markNotificationRead = async (id: string) =>
  check(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id));
export const markAllRead = async () => check(await supabase.rpc('mark_all_notifications_read'));
export const sendTestNotification = async () => check(await supabase.rpc('send_test_notification'));
export async function fetchDisabledKinds(userId: string): Promise<string[]> {
  const row = check(await supabase.from('notification_prefs').select('disabled').eq('user_id', userId).maybeSingle()) as
    { disabled: string[] } | null;
  return row?.disabled ?? [];
}
export async function saveDisabledKinds(userId: string, disabled: string[]) {
  check(await supabase.from('notification_prefs').upsert({ user_id: userId, disabled, updated_at: new Date().toISOString() }));
}

// ---------- الأعضاء ----------
export const removeMember = async (userId: string) => check(await supabase.rpc('remove_member', { p_user: userId }));
export const transferOwnership = async (userId: string) => check(await supabase.rpc('transfer_ownership', { p_user: userId }));

// ---------- السنوات ----------
export const fetchYearOverview = async () => check(await supabase.rpc('year_overview')) as YearRow[];
export async function archiveYear(year: number) {
  const paths = check(await supabase.rpc('archive_year', { p_year: year })) as string[];
  // صور الفواتير تُحذف من التخزين على دفعات
  for (let i = 0; i < paths.length; i += 100) await supabase.storage.from('receipts').remove(paths.slice(i, i + 100));
  return paths.length;
}

// ---------- كشوفات البنك (قسم منفصل عن المصاريف) ----------
export const fetchStatements = async (householdId: string) =>
  check(
    await supabase.from('statement_imports').select('id,name,bank,period_from,period_to,notes,created_at')
      .eq('household_id', householdId).order('created_at', { ascending: false }),
  ) as StatementImport[];
export const fetchStatementRows = async (importId: string) =>
  check(
    await supabase.from('statement_rows')
      .select('id,import_id,txn_date,direction,amount,kind,description,merchant,category_id,matched_expense_id')
      .eq('import_id', importId).order('txn_date', { ascending: false }).order('sort_order').limit(5000),
  ) as StatementRow[];
export const setStatementRowCategory = async (id: string, categoryId: string | null) =>
  check(await supabase.from('statement_rows').update({ category_id: categoryId }).eq('id', id));
export const deleteStatement = async (id: string) => check(await supabase.from('statement_imports').delete().eq('id', id));
