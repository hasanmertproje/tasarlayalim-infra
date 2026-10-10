import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

type AuthSession = {
  configured: boolean;
  authenticated: boolean;
  email?: string;
  expiresAt?: string;
  twoFactorEnabled?: boolean;
  trustedDevice?: boolean;
};

type AuthContextValue = {
  session: AuthSession;
  logout: (forgetDevice?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};

type AuthStep = 'credentials' | 'setup-2fa' | 'verify-2fa' | 'recovery-codes';

type LoginResponse = {
  error?: string;
  authenticated?: boolean;
  email?: string;
  expiresAt?: string;
  requiresTwoFactorSetup?: boolean;
  requiresTwoFactor?: boolean;
  challengeId?: string;
  secret?: string;
  otpauthUri?: string;
  trustedDevice?: boolean;
  recoveryCodes?: string[];
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

function safeDeviceName() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android cihaz';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/windows/i.test(ua)) return 'Windows cihaz';
  if (/macintosh/i.test(ua)) return 'Mac';
  return 'Bu tarayıcı';
}

export default function AuthGateV17({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession>({ configured: true, authenticated: false });
  const [status, setStatus] = useState<'loading' | 'ready' | 'service-error'>('loading');
  const [step, setStep] = useState<AuthStep>('credentials');
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pendingSession, setPendingSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`session:${response.status}`);
      const next = await response.json() as AuthSession;
      setSession(next);
      if (!next.authenticated) setStep('credentials');
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

  useEffect(() => {
    if (!otpauthUri) { setQrDataUrl(''); return; }
    let active = true;
    QRCode.toDataURL(otpauthUri, { width: 240, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrDataUrl(url); })
      .catch(() => { if (active) setQrDataUrl(''); });
    return () => { active = false; };
  }, [otpauthUri]);

  function clearChallenge() {
    setChallengeId('');
    setTotpSecret('');
    setOtpauthUri('');
    setQrDataUrl('');
    setCode('');
    setRecoveryCodes([]);
    setPendingSession(null);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    clearChallenge();
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({})) as LoginResponse;
      if (!response.ok) {
        if (response.status === 429) setError('Çok fazla başarısız deneme yapıldı. Bir süre sonra tekrar deneyin.');
        else if (response.status === 503) setError(body.error || 'Taso giriş sistemi henüz yapılandırılmamış.');
        else setError(body.error || 'Giriş yapılamadı.');
        return;
      }

      setPassword('');
      if (body.authenticated) {
        setSession({ configured: true, authenticated: true, email: body.email, expiresAt: body.expiresAt, twoFactorEnabled: true, trustedDevice: true });
        setStep('credentials');
        return;
      }

      if (body.requiresTwoFactorSetup && body.challengeId && body.secret && body.otpauthUri) {
        setChallengeId(body.challengeId);
        setTotpSecret(body.secret);
        setOtpauthUri(body.otpauthUri);
        setStep('setup-2fa');
        return;
      }

      if (body.requiresTwoFactor && body.challengeId) {
        setChallengeId(body.challengeId);
        setStep('verify-2fa');
        return;
      }

      setError(body.error || 'Giriş akışı doğrulanamadı.');
    } catch {
      setError('Taso Core ile bağlantı kurulamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSecondFactor(event: FormEvent, setup: boolean) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(setup ? '/api/auth/2fa/setup/confirm' : '/api/auth/2fa/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId, code, deviceName: safeDeviceName() }),
      });
      const body = await response.json().catch(() => ({})) as LoginResponse;
      if (!response.ok || !body.authenticated) {
        setError(body.error || 'Authenticator kodu doğrulanamadı.');
        return;
      }

      const authenticated: AuthSession = {
        configured: true,
        authenticated: true,
        email: body.email || email,
        expiresAt: body.expiresAt,
        twoFactorEnabled: true,
        trustedDevice: true,
      };
      setCode('');

      if (setup && body.recoveryCodes?.length) {
        setRecoveryCodes(body.recoveryCodes);
        setPendingSession(authenticated);
        setStep('recovery-codes');
      } else {
        setSession(authenticated);
        setStep('credentials');
      }
    } catch {
      setError('İkinci doğrulama servisine ulaşılamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  const logout = useCallback(async (forgetDevice = false) => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ forgetDevice }),
      });
    } finally {
      setSession({ configured: true, authenticated: false, twoFactorEnabled: true, trustedDevice: !forgetDevice });
      setPassword('');
      setStep('credentials');
    }
  }, []);

  const context = useMemo<AuthContextValue>(() => ({ session, logout, refresh }), [logout, refresh, session]);

  const themeButton = (
    <button
      className="auth-v17-theme"
      type="button"
      aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
      onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );

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
        {themeButton}
        <div className="auth-v17-ambient" aria-hidden="true"><span /><span /><span /></div>
        <section className="auth-v17-shell">
          <div className="auth-v17-intro">
            <div className="auth-v17-brandmark">T</div>
            <p className="auth-v17-kicker">TASO / AI OPERATIONS</p>
            <h1>Kontrol merkezi,<br />yalnızca yetkili erişim.</h1>
            <p className="auth-v17-copy">Projeler, mission akışları, agent operasyonları ve production kararları güvenli oturum ve cihaz doğrulamasıyla korunur.</p>
            <div className="auth-v17-signal"><span /> 2FA + trusted device koruması</div>
          </div>

          {step === 'credentials' && (
            <form className="auth-v17-panel" onSubmit={login}>
              <header>
                <span className="auth-v17-eyebrow">GÜVENLİ GİRİŞ</span>
                <h2>Taso’ya giriş yap</h2>
                <p>E-posta ve şifrenizle devam edin.</p>
              </header>
              <label><span>E-posta</span><input type="email" autoComplete="username" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" required autoFocus /></label>
              <label><span>Şifre</span><div className="auth-v17-password"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Şifrenizi girin" required /><button type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Gizle' : 'Göster'}</button></div></label>
              {error && <div className="auth-v17-error" role="alert">{error}</div>}
              <button className="auth-v17-primary" type="submit" disabled={submitting}>{submitting ? 'Doğrulanıyor…' : 'Giriş yap'}</button>
              <p className="auth-v17-footnote">Güvenilir cihazdaysanız Authenticator tekrar istenmez. Yeni veya süresi dolmuş cihazlarda ikinci doğrulama açılır.</p>
            </form>
          )}

          {step === 'setup-2fa' && (
            <form className="auth-v17-panel auth-v18-2fa" onSubmit={(event) => void submitSecondFactor(event, true)}>
              <header><span className="auth-v17-eyebrow">AUTHENTICATOR KURULUMU</span><h2>İki adımlı doğrulamayı etkinleştirin</h2><p>Authenticator uygulamanızla QR kodu tarayın ve oluşan 6 haneli kodu girin.</p></header>
              <div className="auth-v18-qr">{qrDataUrl ? <img src={qrDataUrl} alt="Taso Authenticator QR kodu" /> : <div className="auth-v18-qr-loading">QR hazırlanıyor…</div>}</div>
              <div className="auth-v18-secret"><span>Manuel kurulum anahtarı</span><code>{totpSecret}</code></div>
              <label><span>6 haneli Authenticator kodu</span><input className="auth-v18-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required autoFocus /></label>
              {error && <div className="auth-v17-error" role="alert">{error}</div>}
              <button className="auth-v17-primary" type="submit" disabled={submitting || code.length !== 6}>{submitting ? 'Doğrulanıyor…' : '2FA’yı etkinleştir'}</button>
              <button className="auth-v18-secondary" type="button" onClick={() => { clearChallenge(); setError(''); setStep('credentials'); }}>Girişe dön</button>
            </form>
          )}

          {step === 'verify-2fa' && (
            <form className="auth-v17-panel auth-v18-2fa" onSubmit={(event) => void submitSecondFactor(event, false)}>
              <header><span className="auth-v17-eyebrow">YENİ CİHAZ DOĞRULAMASI</span><h2>Authenticator kodunuzu girin</h2><p>Bu cihaz doğrulandıktan sonra admin politikasındaki süre boyunca tekrar kod istemeyeceğiz.</p></header>
              <div className="auth-v18-device"><span className="auth-v18-device-dot" /><div><strong>{safeDeviceName()}</strong><small>Bu cihaz güvenilir olarak kaydedilecek</small></div></div>
              <label><span>Authenticator veya kurtarma kodu</span><input className="auth-v18-code" inputMode="text" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 32))} placeholder="000000" required autoFocus /></label>
              {error && <div className="auth-v17-error" role="alert">{error}</div>}
              <button className="auth-v17-primary" type="submit" disabled={submitting || code.length < 6}>{submitting ? 'Doğrulanıyor…' : 'Cihazı doğrula'}</button>
              <button className="auth-v18-secondary" type="button" onClick={() => { clearChallenge(); setError(''); setStep('credentials'); }}>Girişe dön</button>
            </form>
          )}

          {step === 'recovery-codes' && (
            <section className="auth-v17-panel auth-v18-2fa">
              <header><span className="auth-v17-eyebrow">KURTARMA KODLARI</span><h2>Bu kodları güvenli bir yerde saklayın</h2><p>Authenticator erişiminiz kaybolursa her kod yalnızca bir kez kullanılabilir. Bu liste güvenlik nedeniyle tekrar gösterilmeyecektir.</p></header>
              <div className="auth-v18-recovery-grid">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
              <button className="auth-v18-copy" type="button" onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join('\n'))}>Kodları kopyala</button>
              <button className="auth-v17-primary" type="button" onClick={() => { if (pendingSession) setSession(pendingSession); setPendingSession(null); setRecoveryCodes([]); setStep('credentials'); }}>Kodları kaydettim, dashboard’a geç</button>
            </section>
          )}
        </section>
      </main>
    );
  }

  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}
