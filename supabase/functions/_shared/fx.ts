// أسعار الصرف: من الجدول إن وُجد سعر اليوم، وإلا من خدمة مجانية، ثم يُحفظ للعائلات الأخرى.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

// الريال مربوط بالدولار؛ والعملات الخليجية المربوطة كذلك. تُستخدم إذا تعذّر الجلب.
const PEGGED: Record<string, number> = { USD: 3.75, AED: 1.021, BHD: 9.9734, QAR: 1.0302, OMR: 9.7403, JOD: 5.2891 };

async function fetchRates(): Promise<Record<string, number> | null> {
  const sources = [
    async () => {
      const r = await fetch('https://open.er-api.com/v6/latest/SAR', { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      return j?.result === 'success' ? (j.rates as Record<string, number>) : null;
    },
    async () => {
      const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/sar.json',
        { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      return j?.sar ? Object.fromEntries(Object.entries(j.sar as Record<string, number>).map(([k, v]) => [k.toUpperCase(), v])) : null;
    },
  ];
  for (const s of sources) {
    try {
      const rates = await s();
      if (rates && Object.keys(rates).length > 20) return rates;
    } catch { /* نجرب المصدر التالي */ }
  }
  return null;
}

/** كم ريال تساوي وحدة واحدة من العملة، بسعر اليوم */
export async function rateToSar(db: SupabaseClient, currency: string, today: string): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === 'SAR') return 1;
  const cached = await db.from('fx_rates').select('rate_to_sar').eq('rate_date', today).eq('currency', cur).maybeSingle();
  if (cached.data) return Number(cached.data.rate_to_sar);

  const perSar = await fetchRates();
  if (perSar) {
    const rows = Object.entries(perSar)
      .filter(([code, v]) => /^[A-Z]{3}$/.test(code) && code !== 'SAR' && v > 0)
      .map(([code, v]) => ({ rate_date: today, currency: code, rate_to_sar: Number((1 / v).toFixed(8)), source: 'api' }));
    await db.from('fx_rates').upsert(rows, { onConflict: 'rate_date,currency', ignoreDuplicates: true });
    const v = perSar[cur];
    if (v && v > 0) return 1 / v;
  }
  // آخر سعر محفوظ، أو الربط الثابت
  const last = await db.from('fx_rates').select('rate_to_sar').eq('currency', cur)
    .order('rate_date', { ascending: false }).limit(1).maybeSingle();
  if (last.data) return Number(last.data.rate_to_sar);
  return PEGGED[cur] ?? null;
}
