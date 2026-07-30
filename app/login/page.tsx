'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { hasSupabaseEnv } from '@/lib/env';

type AuthMode = 'login' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasSupabaseEnv) {
      setMessage('Authentication is not configured on this deployment yet.');
      return;
    }

    setLoading(true);
    setMessage(null);
    const supabase = createClient();

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName.trim() || email.split('@')[0] },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      setLoading(false);
      if (error) return setMessage(error.message);
      setMessage('Account created. Check your email to confirm your address.');
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setMessage(error.message);

    router.replace(searchParams.get('next') || '/');
    router.refresh();
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'radial-gradient(circle at 50% 0%, #241454 0, #0a0910 42%, #060609 100%)' }}>
      <section style={{ width: 'min(440px, 100%)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 24, padding: 32, background: 'rgba(13,12,20,.86)', boxShadow: '0 30px 100px rgba(0,0,0,.45)', backdropFilter: 'blur(24px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 30 }}>
          <div className="brand-mark">m</div>
          <div><strong style={{ fontSize: 20 }}>m.ai</strong><div style={{ color: '#918da4', fontSize: 13 }}>Your personal AI operating system</div></div>
        </div>

        <p className="eyebrow">SECURE WORKSPACE</p>
        <h1 style={{ margin: '8px 0 10px', fontSize: 32 }}>{mode === 'login' ? 'Welcome back.' : 'Create your workspace.'}</h1>
        <p style={{ color: '#aaa6b8', margin: '0 0 26px', lineHeight: 1.6 }}>{mode === 'login' ? 'Sign in to access your conversations, files and AI tools.' : 'Your data is isolated by account-level database security.'}</p>

        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          {mode === 'signup' && <label style={{ display: 'grid', gap: 7, fontSize: 13, color: '#c8c5d2' }}>Display name<input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} autoComplete="name" /></label>}
          <label style={{ display: 'grid', gap: 7, fontSize: 13, color: '#c8c5d2' }}>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="email" /></label>
          <label style={{ display: 'grid', gap: 7, fontSize: 13, color: '#c8c5d2' }}>Password<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          <button disabled={loading || !hasSupabaseEnv} className="submit-button" style={{ marginTop: 6, minHeight: 48, justifyContent: 'center' }}>{loading ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>

        {message && <div className="notice" style={{ marginTop: 16 }}><span>i</span>{message}</div>}
        {!hasSupabaseEnv && <div className="notice" style={{ marginTop: 16 }}><span>!</span>Supabase environment variables are missing from this deployment.</div>}

        <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(null); }} style={{ width: '100%', marginTop: 22, border: 0, background: 'transparent', color: '#b9b4cc', cursor: 'pointer' }}>
          {mode === 'login' ? 'New to m.ai? Create an account' : 'Already have an account? Sign in'}
        </button>
      </section>
    </main>
  );
}

const inputStyle = {
  width: '100%',
  minHeight: 46,
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,.13)',
  background: 'rgba(255,255,255,.055)',
  color: 'white',
  padding: '0 13px',
  outline: 'none',
} as const;
