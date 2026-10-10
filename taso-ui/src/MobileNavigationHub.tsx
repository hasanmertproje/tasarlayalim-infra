import { useEffect, useRef, useState } from 'react';
import { TASO_SCREENS, useTasoNavigation, type TasoScreen } from './navigation';

const descriptions: Record<TasoScreen, string> = {
  'Command Center': 'Ana kontrol merkezi',
  Projects: 'Workspace ve projeler',
  Tasks: 'Mission ve görev yürütme',
  Approvals: 'İnsan onayı gereken işlemler',
  Deployments: 'Preview ve production akışı',
  'AI Agents': 'Agent Operations Center',
  Knowledge: 'Project knowledge ve manifest',
  Integrations: 'GitHub · Coolify · servisler',
  Monitoring: 'Sistem ve servis durumu',
  Settings: 'Taso ayarları',
  Notifications: 'Bildirim merkezi',
  Infrastructure: 'Altyapı ve servis görünürlüğü',
};

const groups: Array<{ label: string; screens: TasoScreen[] }> = [
  { label: 'Çalışma alanı', screens: ['Command Center', 'Projects', 'Tasks', 'Approvals'] },
  { label: 'Operasyon', screens: ['Deployments', 'AI Agents', 'Monitoring', 'Infrastructure'] },
  { label: 'Bilgi ve bağlantılar', screens: ['Knowledge', 'Integrations', 'Notifications'] },
  { label: 'Sistem', screens: ['Settings'] },
];

function NavIcon({ screen }: { screen: TasoScreen }) {
  const glyphs: Record<TasoScreen, string> = {
    'Command Center': '⌂', Projects: '◫', Tasks: '✓', Approvals: '◆', Deployments: '↗',
    'AI Agents': '✦', Knowledge: '◇', Integrations: '⌘', Monitoring: '◉', Settings: '⚙',
    Notifications: '●', Infrastructure: '▦',
  };
  return <span className="taso-nav-glyph" aria-hidden="true">{glyphs[screen]}</span>;
}

export default function MobileNavigationHub() {
  const [open, setOpen] = useState(false);
  const [active, navigate] = useTasoNavigation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.body.classList.add('taso-navigation-open');
    window.addEventListener('keydown', onKey);
    window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.classList.remove('taso-navigation-open');
      window.removeEventListener('keydown', onKey);
      moreRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  function openScreen(screen: TasoScreen) {
    navigate(screen);
    setOpen(false);
  }

  const directScreens: TasoScreen[] = ['Command Center', 'Projects', 'Tasks'];
  const moreActive = !directScreens.includes(active);

  return (
    <>
      <nav className="mobile-nav taso-mobile-dock" aria-label="Taso ana navigasyonu">
        <button type="button" className={active === 'Command Center' ? 'active' : ''} onClick={() => openScreen('Command Center')} aria-current={active === 'Command Center' ? 'page' : undefined}>
          <NavIcon screen="Command Center" /><span>Ana Sayfa</span>
        </button>
        <button type="button" className={active === 'Projects' ? 'active' : ''} onClick={() => openScreen('Projects')} aria-current={active === 'Projects' ? 'page' : undefined}>
          <NavIcon screen="Projects" /><span>Projeler</span>
        </button>
        <button type="button" className="mobile-taso taso-mobile-voice" aria-label="Taso ile konuş">
          <span className="taso-mobile-core" aria-hidden="true">T</span><span>Taso</span>
        </button>
        <button type="button" className={active === 'Tasks' ? 'active' : ''} onClick={() => openScreen('Tasks')} aria-current={active === 'Tasks' ? 'page' : undefined}>
          <NavIcon screen="Tasks" /><span>Görevler</span>
        </button>
        <button ref={moreRef} type="button" className={moreActive || open ? 'active' : ''} onClick={() => setOpen(true)} aria-expanded={open} aria-controls="taso-mobile-navigation-panel">
          <span className="taso-more-glyph" aria-hidden="true"><i/><i/><i/></span><span>Menü</span>
        </button>
      </nav>

      {open && (
        <section id="taso-mobile-navigation-panel" className="taso-navigation-panel" role="dialog" aria-modal="true" aria-label="Taso navigasyonu">
          <header className="taso-navigation-header">
            <div><span>TASO</span><strong>Navigasyon</strong><small>{active}</small></div>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Navigasyonu kapat">×</button>
          </header>

          <div className="taso-navigation-scroll">
            {groups.map((group) => (
              <section className="taso-navigation-group" key={group.label}>
                <h2>{group.label}</h2>
                <div className="taso-navigation-list">
                  {group.screens.map((screen) => (
                    <button key={screen} type="button" className={active === screen ? 'active' : ''} aria-current={active === screen ? 'page' : undefined} onClick={() => openScreen(screen)}>
                      <NavIcon screen={screen} />
                      <span className="taso-navigation-copy"><strong>{screen}</strong><small>{descriptions[screen]}</small></span>
                      <span className="taso-navigation-chevron" aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="taso-navigation-footer">
            <small>{TASO_SCREENS.length} ekran · tüm modüllere mobil erişim</small>
          </footer>
        </section>
      )}
    </>
  );
}
