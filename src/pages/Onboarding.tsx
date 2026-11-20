import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, Field, cx } from '../components/ui';
import { Logo } from '../components/Logo';
import { createHousehold, joinHousehold } from '../lib/api';
import { supabase } from '../lib/supabase';

export default function Onboarding() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return toast.error('اكتب اسمك');
    setLoading(true);
    try {
      if (mode === 'create') await createHousehold(householdName, displayName);
      else await joinHousehold(code, displayName);
      await qc.invalidateQueries({ queryKey: ['household'] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <Logo className="mb-5 size-14" />
        <h1 className="display text-[30px]">لنجهّز حسابكم</h1>
        <p className="mt-2 text-muted">أحدكما ينشئ العائلة، والآخر ينضم برمز الدعوة من صفحة الإعدادات.</p>

        <div className="mt-6 grid grid-cols-2 rounded-full bg-surface-2 p-1" role="tablist">
          {(['create', 'join'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cx('h-10 rounded-full text-sm font-medium transition', mode === m ? 'bg-surface text-ink shadow-[var(--shadow-lift)]' : 'text-muted')}>
              {m === 'create' ? 'إنشاء عائلة' : 'لدي رمز دعوة'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="اسمك كما سيظهر في العمليات" placeholder="أبو محمد، أم محمد…" maxLength={30} required
            value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          {mode === 'create'
            ? <Field label="اسم العائلة (اختياري)" placeholder="بيت العائلة" maxLength={60} value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
            : <Field label="رمز الدعوة" dir="ltr" required className="[&_input]:text-center [&_input]:tracking-[.3em] [&_input]:uppercase"
                value={code} onChange={(e) => setCode(e.target.value)} />}
          <Button type="submit" variant="brand" loading={loading} className="h-14 w-full text-base">{mode === 'create' ? 'إنشاء العائلة' : 'انضمام'}</Button>
        </form>
        <button type="button" onClick={() => supabase.auth.signOut()} className="mt-5 w-full text-center text-sm text-muted hover:text-ink">
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}
