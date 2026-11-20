import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button, Field } from '../components/ui';
import { Logo } from '../components/Logo';
import { translateError } from '../lib/api';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href.split('#')[0] } });
    setLoading(false);
    if (error) return toast.error(translateError(error.message));
    if (mode === 'signup' && !data.session) toast.success('أرسلنا رابط التأكيد إلى بريدك، افتحه ثم سجّل الدخول');
  }

  return (
    <div className="pt-safe flex min-h-dvh flex-col p-4">
      <section className="panel flex flex-1 flex-col justify-end p-7 pb-8">
        <Logo className="mb-6 size-14" />
        <h1 className="display text-[34px]">مصاريف البيت</h1>
        <p className="mt-3 max-w-xs leading-relaxed text-panel-muted">سجّلوا مصاريف العائلة في ثوانٍ، واعرفوا أين يذهب كل ريال.</p>
      </section>
      <div className="mx-auto w-full max-w-sm px-2 pb-6 pt-7">
        <form onSubmit={submit} className="space-y-4">
          <Field label="البريد الإلكتروني" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="كلمة المرور" type="password" dir="ltr" minLength={8} required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" variant="brand" loading={loading} className="h-14 w-full text-base">
            {mode === 'signin' ? 'تسجيل الدخول' : 'إنشاء حساب'}
          </Button>
        </form>
        <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-5 w-full text-center text-sm text-muted hover:text-ink">
          {mode === 'signin' ? 'ليس لديك حساب؟ أنشئ حساباً' : 'لديك حساب؟ سجّل الدخول'}
        </button>
      </div>
    </div>
  );
}
