import { useEffect, useState } from 'react';
import { useAuthSession } from './AuthGateV17';

type Theme = 'dark' | 'light';

function resolveTheme(): Theme {
  const stored = localStorage.getItem('taso-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function GlobalUiControlsV11() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme());
  const { session, logout } = useAuthSession();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('taso-theme', theme);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#07111a' : '#eef3f7';
  }, [theme]);

  return (
    <div className="global-ui-v11" aria-label="Görünüm ve oturum kontrolleri">
      <div className="auth-user-v17" aria-label="Aktif oturum">
        <span title={session.email}>{session.email}</span>
        <button type="button" onClick={() => void logout()}>Çıkış</button>
      </div>
      <button
        type="button"
        className="global-theme-v11"
        aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
        title={theme === 'dark' ? 'Açık tema' : 'Koyu tema'}
        onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
      >
        <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
        <b>{theme === 'dark' ? 'AÇIK' : 'KOYU'}</b>
      </button>
    </div>
  );
}
