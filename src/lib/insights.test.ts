import { describe, expect, it } from 'vitest';
import { makeExpense as exp } from './fixtures';
import { anomalies, buildFacts, habits, merchantKey, recurringCandidates, salaryEffect, weekdayStats } from './insights';
import { yearComparison } from './stats';

describe('merchantKey', () => {
  it('groups branches of the same merchant', () => {
    expect(merchantKey('نون*88123')).toBe(merchantKey('نون'));
    expect(merchantKey('Starbucks 1023')).toBe('starbucks');
    expect(merchantKey('مكتبة جرير')).toBe(merchantKey('مكتبه جرير'));
  });
});

describe('weekdayStats', () => {
  it('averages per weekday occurrence', () => {
    // 2026-10-01 خميس، 2026-10-08 خميس
    const list = [exp('1', 'a', 10000, '2026-10-01'), exp('2', 'a', 30000, '2026-10-08'), exp('3', 'a', 5000, '2026-10-03')];
    const w = weekdayStats(list, '2026-10-01', '2026-10-14');
    expect(w[4]).toMatchObject({ name: 'الخميس', total: 40000, avgPerDay: 20000 });
    expect(w[6]).toMatchObject({ name: 'السبت', total: 5000, avgPerDay: 2500 });
    expect(w.reduce((a, x) => a + x.percent, 0)).toBe(100);
  });
});

describe('salaryEffect', () => {
  it('compares the first week after salary with the rest of the cycle', () => {
    const list = [];
    // ثلاث دورات: 27 يونيو → 27 يوليو → 27 أغسطس → 27 سبتمبر
    for (const start of ['2026-06-27', '2026-07-27', '2026-08-27']) {
      list.push(exp(`${start}a`, 'a', 70000, start)); // 700 ر.س في يوم الراتب
    }
    list.push(exp('x', 'a', 23000, '2026-07-15'), exp('y', 'a', 23000, '2026-08-15'), exp('z', 'a', 23000, '2026-09-15'));
    const s = salaryEffect(list, 27, '2026-10-05');
    expect(s.firstWeekDaily).toBe(10000); // 2100 ر.س / 21 يوم
    expect(s.restDaily).toBe(Math.round(69000 / (92 - 21)));
    expect(s.ratio).toBeGreaterThan(9);
  });
});

describe('recurringCandidates', () => {
  it('finds monthly payments with a stable amount that are not in fixed expenses', () => {
    const list = [
      exp('1', 'a', 5600, '2026-07-03', { merchant: 'Netflix' }),
      exp('2', 'a', 5600, '2026-08-03', { merchant: 'NETFLIX' }),
      exp('3', 'a', 5600, '2026-09-04', { merchant: 'Netflix' }),
      exp('4', 'a', 5800, '2026-10-03', { merchant: 'Netflix' }),
      // يتكرر لكن متغير جداً
      exp('5', 'b', 2000, '2026-08-10', { merchant: 'بنده' }), exp('6', 'b', 9000, '2026-09-10', { merchant: 'بنده' }),
      exp('7', 'b', 4000, '2026-10-10', { merchant: 'بنده' }),
      // مضاف للثابتة
      exp('8', 'a', 30000, '2026-08-01', { merchant: 'STC' }), exp('9', 'a', 30000, '2026-09-01', { merchant: 'STC' }),
      exp('10', 'a', 30000, '2026-10-01', { merchant: 'STC' }),
    ];
    const r = recurringCandidates(list, [{ id: 'r', household_id: 'h', category_id: 'a', name: 'فاتورة STC', amount: 30000, day_of_month: 1, start_month: '2026-01-01', is_active: true }], '2026-10-20');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Netflix', amount: 5600, months: 4, day: 3 });
  });
});

describe('habits & anomalies', () => {
  it('frequent merchants', () => {
    const list = ['01', '03', '05', '09'].map((d, i) => exp(`c${i}`, 'a', 1800, `2026-10-${d}`, { merchant: 'ستاربكس' }));
    expect(habits(list, '2026-10-01', '2026-10-31')[0]).toMatchObject({ name: 'ستاربكس', count: 4, total: 7200, avg: 1800 });
  });

  it('flags amounts far above the usual for that merchant', () => {
    const hist = ['06', '07', '08', '09'].map((m) => exp(`h${m}`, 'a', 30000, `2026-${m}-12`, { merchant: 'الدانوب' }));
    const big = exp('big', 'a', 95000, '2026-10-12', { merchant: 'الدانوب' });
    const normal = exp('n', 'a', 32000, '2026-10-14', { merchant: 'الدانوب' });
    const r = anomalies([...hist, big, normal], '2026-10-01', '2026-10-31');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ typical: 30000, basis: 'merchant' });
  });
});

describe('buildFacts', () => {
  it('excludes trips and compares the same number of days', () => {
    const list = [
      exp('1', 'a', 10000, '2026-10-02'), exp('2', 'a', 99999, '2026-10-03', { trip_id: 't' }),
      exp('3', 'a', 4000, '2026-09-02'), exp('4', 'a', 50000, '2026-09-20'),
    ];
    const f = buildFacts({ month: '2026-10-01', today: '2026-10-05', expenses: list, categories: [], budget: 100000, salaryDay: 27, recurring: [] });
    expect(f).toMatchObject({ total_sar: 100, transactions: 1, same_days_last_month_sar: 40, change_vs_last_month_percent: 150, budget_used_percent: 10 });
  });
});

describe('yearComparison', () => {
  it('compares only the same months of both years', () => {
    const rows = [
      { month: '2026-01-01', category_id: 'a', total: 1000, tx_count: 1 },
      { month: '2026-02-01', category_id: 'a', total: 3000, tx_count: 1 },
      { month: '2025-01-01', category_id: 'a', total: 2000, tx_count: 1 },
      { month: '2025-12-01', category_id: 'a', total: 9999, tx_count: 1 },
    ];
    const c = yearComparison(rows, 2026, 2);
    expect(c).toMatchObject({ current: 4000, previous: 2000, change: 1 });
    expect(c.months).toHaveLength(2);
  });
});
