import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as api from '../lib/api';
import { addMonths, monthEnd } from '../lib/dates';
import type { ISODate, MonthKey } from '../lib/types';
import { useHousehold } from './household';

export const keys = {
  household: (uid: string) => ['household', uid] as const,
  categories: (h: string) => ['categories', h] as const,
  expenses: (h: string, from: string, to: string) => ['expenses', h, from, to] as const,
  monthly: (h: string, from: string) => ['monthly', h, from] as const,
  recurring: (h: string) => ['recurring', h] as const,
  recurringPayments: (h: string, m: string) => ['recurring-payments', h, m] as const,
  cards: (h: string) => ['cards', h] as const,
  trips: (h: string) => ['trips', h] as const,
  tripExpenses: (t: string) => ['trip-expenses', t] as const,
  renewals: (h: string) => ['renewals', h] as const,
  notifications: (u: string) => ['notifications', u] as const,
  prefs: (u: string) => ['prefs', u] as const,
  sms: (u: string) => ['sms', u] as const,
  snapshots: (h: string) => ['snapshots', h] as const,
  years: (h: string) => ['years', h] as const,
};

/** كل ما يتأثر بتغيير في المصروفات */
export const EXPENSE_DEPENDENT = ['expenses', 'monthly', 'recurring-payments', 'trip-expenses', 'trips', 'years', 'sms'];

const onError = (e: Error) => toast.error(e.message);

export function useInvalidate() {
  const qc = useQueryClient();
  return (...roots: string[]) =>
    Promise.all(roots.map((r) => qc.invalidateQueries({ queryKey: [r] })));
}

export function useCategories() {
  const { household } = useHousehold();
  return useQuery({ queryKey: keys.categories(household.id), queryFn: () => api.fetchCategories(household.id) });
}

export function useExpenses(from: ISODate, to: ISODate) {
  const { household } = useHousehold();
  return useQuery({
    queryKey: keys.expenses(household.id, from, to),
    queryFn: () => api.fetchExpenses(household.id, from, to),
    placeholderData: (prev) => prev, // يبقي البيانات السابقة أثناء التنقل بين الأشهر
  });
}

export const useMonthExpenses = (month: MonthKey) => useExpenses(month, monthEnd(month));

export function useMonthlyTotals(currentMonth: MonthKey, count = 6) {
  const { household } = useHousehold();
  const from = addMonths(currentMonth, -(count - 1));
  return useQuery({
    queryKey: keys.monthly(household.id, from),
    queryFn: () => api.fetchMonthlyTotals(household.id, from),
    placeholderData: (prev) => prev,
  });
}

export function useRecurring() {
  const { household } = useHousehold();
  return useQuery({ queryKey: keys.recurring(household.id), queryFn: () => api.fetchRecurring(household.id) });
}

export function useRecurringPayments(month: MonthKey) {
  const { household } = useHousehold();
  return useQuery({
    queryKey: keys.recurringPayments(household.id, month),
    queryFn: () => api.fetchRecurringPayments(household.id, month),
  });
}

// ---------- عمليات الكتابة ----------
export function useSaveExpense() {
  const { household } = useHousehold();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { input: api.ExpenseInput; id?: string; receipt?: File | null }) =>
      api.saveExpense(household.id, v.input, { id: v.id, receipt: v.receipt }),
    onSettled: () => invalidate(...EXPENSE_DEPENDENT),
    onError,
  });
}

export function useDeleteExpense() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.deleteExpense,
    onSuccess: () => toast.success('تم حذف العملية'),
    onSettled: () => invalidate(...EXPENSE_DEPENDENT),
    onError,
  });
}

export function useSaveCategory() {
  const { household } = useHousehold();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { input: api.CategoryInput; id?: string }) => api.saveCategory(household.id, v.input, v.id),
    onSuccess: () => toast.success('تم حفظ التصنيف'),
    onSettled: () => invalidate('categories'),
    onError,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: () => toast.success('تم حذف التصنيف'),
    onSettled: () => invalidate('categories'),
    onError,
  });
}

export function useSaveRecurring() {
  const { household } = useHousehold();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { input: api.RecurringInput; id?: string }) => api.saveRecurring(household.id, v.input, v.id),
    onSuccess: () => toast.success('تم حفظ المصروف الثابت'),
    onSettled: () => invalidate('recurring'),
    onError,
  });
}

export function useDeleteRecurring() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.deleteRecurring,
    onSuccess: () => toast.success('تم حذف المصروف الثابت'),
    onSettled: () => invalidate('recurring', ...EXPENSE_DEPENDENT),
    onError,
  });
}

export function useMarkPaid() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { recurringId: string; period: MonthKey; date: ISODate }) =>
      api.markRecurringPaid(v.recurringId, v.period, v.date),
    onSettled: () => invalidate(...EXPENSE_DEPENDENT),
    onError,
  });
}

export function useUpdateHousehold() {
  const { household, me } = useHousehold();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (v: { name?: string; monthly_budget?: number | null; salary_day?: number; display_name?: string }) => {
      const { display_name, ...patch } = v;
      if (Object.keys(patch).length) await api.updateHousehold(household.id, patch);
      if (display_name) await api.updateDisplayName(household.id, me.user_id, display_name);
    },
    onSuccess: () => toast.success('تم الحفظ'),
    onSettled: () => invalidate('household'),
    onError,
  });
}

// ---------- البطاقات ----------
export function useCards() {
  const { household } = useHousehold();
  return useQuery({ queryKey: keys.cards(household.id), queryFn: () => api.fetchCards(household.id) });
}

export function useSaveCard() {
  const { household } = useHousehold();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { input: api.CardInput; id?: string }) => api.saveCard(household.id, v.input, v.id),
    onSuccess: () => toast.success('تم حفظ البطاقة'),
    onSettled: () => invalidate('cards'),
    onError,
  });
}

export function useDeleteCard() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.deleteCard,
    onSuccess: () => toast.success('تم حذف البطاقة'),
    onSettled: () => invalidate('cards', 'expenses'),
    onError,
  });
}

// ---------- الرحلات ----------
export function useTrips() {
  const { household } = useHousehold();
  return useQuery({ queryKey: keys.trips(household.id), queryFn: () => api.fetchTrips(household.id) });
}

export function useTripExpenses(tripId: string | undefined) {
  return useQuery({
    queryKey: keys.tripExpenses(tripId ?? 'none'),
    queryFn: () => api.fetchTripExpenses(tripId!),
    enabled: Boolean(tripId),
  });
}

export function useSaveTrip() {
  const { household } = useHousehold();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { input: api.TripInput; id?: string }) => api.saveTrip(household.id, v.input, v.id),
    onSettled: () => invalidate('trips', ...EXPENSE_DEPENDENT),
    onError,
  });
}

export function useDeleteTrip() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.deleteTrip,
    onSuccess: () => toast.success('تم حذف الرحلة، ومصاريفها رجعت لمصروف الشهر'),
    onSettled: () => invalidate('trips', ...EXPENSE_DEPENDENT),
    onError,
  });
}

// ---------- التجديدات ----------
export function useRenewals() {
  const { household } = useHousehold();
  return useQuery({ queryKey: keys.renewals(household.id), queryFn: () => api.fetchRenewals(household.id) });
}

export function useSaveRenewal() {
  const { household } = useHousehold();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { input: api.RenewalInput; id?: string }) => api.saveRenewal(household.id, v.input, v.id),
    onSettled: () => invalidate('renewals'),
    onError,
  });
}

export function useDeleteRenewal() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: api.deleteRenewal,
    onSuccess: () => toast.success('تم الحذف'),
    onSettled: () => invalidate('renewals'),
    onError,
  });
}

// ---------- الإشعارات ----------
export function useNotifications() {
  const { me } = useHousehold();
  return useQuery({ queryKey: keys.notifications(me.user_id), queryFn: () => api.fetchNotifications() });
}

export function useUnreadCount() {
  const { data = [] } = useNotifications();
  return data.filter((n) => !n.read_at).length;
}

export function useDisabledKinds() {
  const { me } = useHousehold();
  return useQuery({ queryKey: keys.prefs(me.user_id), queryFn: () => api.fetchDisabledKinds(me.user_id) });
}

export function useSaveDisabledKinds() {
  const { me } = useHousehold();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (disabled: string[]) => api.saveDisabledKinds(me.user_id, disabled),
    onMutate: (disabled) => qc.setQueryData(keys.prefs(me.user_id), disabled),
    onSettled: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
    onError,
  });
}

// ---------- رسائل البنك ----------
export function useSmsMessages() {
  const { me } = useHousehold();
  return useQuery({ queryKey: keys.sms(me.user_id), queryFn: () => api.fetchSmsMessages() });
}

// ---------- التنظيم والسنوات ----------
export function useSnapshots() {
  const { household } = useHousehold();
  return useQuery({ queryKey: keys.snapshots(household.id), queryFn: () => api.fetchSnapshots(household.id) });
}

export function useYearOverview() {
  const { household } = useHousehold();
  return useQuery({ queryKey: keys.years(household.id), queryFn: api.fetchYearOverview });
}
