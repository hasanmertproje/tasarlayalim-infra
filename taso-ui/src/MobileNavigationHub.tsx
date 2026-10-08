import { useEffect, useRef, useState } from 'react';
import { TASO_PRIMARY_SCREENS, useTasoNavigation, type TasoScreen } from './navigation';

const descriptions: Record<(typeof TASO_PRIMARY_SCREENS)[number], string> = {
  'Command Center': 'Ana kontrol merkezi',
  Projects: 'Workspace ve projeler',
  Tasks: 'Görevler ve mission akışı',
  Approvals: 'İnsan onayı gereken işlemler',
  Deployments: 'Preview ve production',
  'AI Agents': 'Agent Operations Center',
  Knowledge: 'Project knowledge ve manifest',
  Integrations: 'GitHub · Coolify · AI',
  Monitoring: 'Sistem ve servis durumu',
  Settings: 'Taso ayarları',
};

export default function MobileNavigationHub() {
  const [open, setOpen] = useState(false);
  const [active, navigate] = useTasoNavigation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.body.classList.add('mobile-screen-menu-open');
    window.addEventListener('keydown', onKey);
    window.requestAnimationFrame(() => closeRef.current?.focus());

    return () => {
      document.body.classList.remove('mobile-screen-menu-open');
      window.removeEventListener('keydown', onKey);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  function openScreen(screen: TasoScreen) {
    navigate(screen);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`mobile-screen-menu-trigger ${open ? 'active' : ''}`}
        aria-label={open ? 'Taso ekran menüsünü kapat' : 'Tüm Taso ekranlarını aç'}
        aria-expanded={open}
        aria-controls="taso-mobile-screen-sheet"
        onClick={() => setOpen((value) => !value)}
      >
        <span /><span /><span />
      </button>

      {open && (
        <div id="taso-mobile-screen-sheet" className="mobile-screen-sheet" role="dialog" aria-modal="true" aria-label="Taso ekranları">
          <button className="mobile-screen-sheet-backdrop" type="button" aria-label="Menüyü kapat" onClick={() => setOpen(false)} />
          <section className="mobile-screen-sheet-panel">
            <header>
              <div><span>TASO</span><strong>Tüm ekranlar</strong><small>{active}</small></div>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Kapat">×</button>
            </header>
            <nav className="mobile-screen-grid" aria-label="Taso ekran seçimi">
              {TASO_PRIMARY_SCREENS.map((screen, index) => (
                <button
                  type="button"
                  key={screen}
                  className={active === screen ? 'active' : ''}
                  aria-current={active === screen ? 'page' : undefined}
                  onClick={() => openScreen(screen)}
                >
                  <span className="mobile-screen-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mobile-screen-copy"><strong>{screen}</strong><small>{descriptions[screen]}</small></span>
                  <span className="mobile-screen-arrow" aria-hidden="true">↗</span>
                </button>
              ))}
            </nav>
          </section>
        </div>
      )}
    </>
  );
}
