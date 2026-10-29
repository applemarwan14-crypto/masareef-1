import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { EXPENSE_DEPENDENT } from './queries';

/** يحدّث البيانات فوراً عندما يضيف أحد أفراد العائلة أو يعدّل شيئاً */
export function useRealtimeSync(householdId: string, userId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = (roots: string[]) => roots.forEach((r) => qc.invalidateQueries({ queryKey: [r] }));
    const filter = `household_id=eq.${householdId}`;
    const channel = supabase
      .channel(`household-${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter }, () => refresh(EXPENSE_DEPENDENT))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter }, () => refresh(['categories']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_expenses', filter }, () => refresh(['recurring']))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` }, () => refresh(['household']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter }, () => refresh(['household']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter }, () => refresh(['trips', 'trip-expenses']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cards', filter }, () => refresh(['cards']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'renewals', filter }, () => refresh(['renewals']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => refresh(['notifications']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sms_messages', filter: `user_id=eq.${userId}` }, () => refresh(['sms']))
      .subscribe();

    // عند العودة للتطبيق بعد غياب
    const onVisible = () => document.visibilityState === 'visible' && refresh([...EXPENSE_DEPENDENT, 'recurring', 'notifications']);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [householdId, userId, qc]);
}
