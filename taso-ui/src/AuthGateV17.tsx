import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type AuthSession = {
  configured: boolean;
  authenticated: boolean;
  email?: string;
  expiresAt?: string;
};

type AuthContextValue = {
  session: AuthSession;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthSession() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuthSession must be used inside AuthGateV17');
  return value;
}

function resolveTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export default function AuthGateV17({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession>({ configured: true, authenticated: false });
  const [status, setStatus] = useState<'loading' | 'ready' | 'service-error'>('loading');
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`session:${response.status}`);
      const next = await response.json() as AuthSession;
      setSession(next);
      setStatus('ready');
    } catch {
      setStatus('service-error');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!session.authenticated) return;
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, session.authenticated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('taso-theme', theme);
  }, [theme]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; authenticated?: boolean; email?: string; expiresAt?: string };
      if (!response.ok || !body.authenticated) {
        if (response.status === 429) setError('Çok fazla başarısız deneme yapıldı. Bir süre sonra tekrar deneyin.');
        else if (response.status === 503) setError('Taso giriş sistemi henüz yapılandırılmamış.');
        else setError(body.error || 'Giriş yapılamadı.');
        return;
      }
      setPassword('');
      setSession({ configured: true, authenticated: true, email: body.email, expiresAt: body.expiresAt });
      setStatus('ready');
    } catch {
      setError('Taso Core ile bağlantı kurulamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    } finally {
      setSession({ configured: true, authenticated: false });
      setPassword('');
    }
  }, []);

  const context = useMemo<AuthContextValue>(() => ({ session, logout, refresh }), [logout, refresh, session]);

  if (status === 'loading') {
    return (
      <main className="auth-v17 auth-v17--loading" aria-live="polite">
        <div className="auth-v17-loader" aria-hidden="true"><i /><i /><i /></div>
        <span>Taso güvenli oturumu hazırlanıyor</span>
      </main>
    );
  }

  if (status === 'service-error') {
    return (
      <main className="auth-v17">
        <section className="auth-v17-panel auth-v17-state-panel">
          <div className="auth-v17-brandmark">T</div>
          <p className="auth-v17-kicker">TASO / CONTROL PLANE</p>
          <h1>Servise ulaşılamıyor</h1>
          <p>Giriş servisi şu anda yanıt vermiyor. Teknik hata ekranına yönlendirilmediniz; bağlantıyı tekrar deneyebilirsiniz.</p>
          <button className="auth-v17-primary" type="button" onClick={() => { setStatus('loading'); void refresh(); }}>Tekrar dene</button>
        </section>
      </main>
    );
  }

  if (!session.configured) {
    return (
      <main className="auth-v17">
        <section className="auth-v17-panel auth-v17-state-panel">
          <div className="auth-v17-brandmark">T</div>
          <p className="auth-v17-kicker">TASO / SECURITY</p>
          <h1>Giriş sistemi yapılandırılmalı</h1>
          <p>Owner e-posta ve parola hash ayarları Core üzerinde yapılandırılmadan dashboard açılmaz.</p>
        </section>
      </main>
    );
  }

  if (!session.authenticated) {
    return (
      <main className="auth-v17">
        <button
          className="auth-v17-theme"
          type="button"
          aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
          onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        <div className="auth-v17-ambient" aria-hidden="true"><span /><span /><span /></div>

        <section className="auth-v17-shell">
          <div className="auth-v17-intro">
            <div className="auth-v17-brandmark">T</div>
            <p className="auth-v17-kicker">TASO / AI OPERATIONS</p>
            <h1>Kontrol merkezi,<br />yalnızca yetkili erişim.</h1>
            <p className="auth-v17-copy">Projeler, mission akışları, agent operasyonları ve production kararları tek güvenli oturumda yönetilir.</p>
            <div className="auth-v17-signal"><span /> Application auth aktif</div>
          </div>

          <form className="auth-v17-panel" onSubmit={login}>
            <header>
              <span className="auth-v17-eyebrow">GÜVENLİ GİRİŞ</span>
              <h2>Taso’ya giriş yap</h2>
              <p>E-posta ve şifrenizle devam edin.</p>
            </header>

            <label>
              <span>E-posta</span>
              <input
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
                required
                autoFocus
              />
            </label>

            <label>
              <span>Şifre</span>
              <div className="auth-v17-password">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Şifrenizi girin"
                  required
                />
                <button type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Gizle' : 'Göster'}</button>
              </div>
            </label>

            {error && <div className="auth-v17-error" role="alert">{error}</div>}

            <button className="auth-v17-primary" type="submit" disabled={submitting}>
              {submitting ? 'Doğrulanıyor…' : 'Giriş yap'}
            </button>

            <p className="auth-v17-footnote">Yeni cihaz doğrulaması ve Authenticator adımı PR #88 trusted-device katmanında etkinleşecek.</p>
          </form>
        </section>
      </main>
    );
  }

  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}
