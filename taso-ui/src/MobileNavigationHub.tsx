import { useEffect, useState } from 'react';

const screens = [
  ['Command Center', 'Ana kontrol merkezi'],
  ['Projects', 'Workspace ve projeler'],
  ['Tasks', 'Görevler ve mission akışı'],
  ['Approvals', 'İnsan onayı gereken işlemler'],
  ['Deployments', 'Preview ve production'],
  ['AI Agents', 'Agent Operations Center'],
  ['Knowledge', 'Project knowledge ve manifest'],
  ['Integrations', 'GitHub · Coolify · AI'],
  ['Monitoring', 'Sistem ve servis durumu'],
  ['Settings', 'Taso ayarları'],
] as const;

function findScreenButton(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label && !button.closest('.mobile-screen-sheet'));
}

export default function MobileNavigationHub() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('Command Center');

  useEffect(() => {
    const sync = () => {
      const heading = document.querySelector('.topbar h1')?.textContent?.trim();
      if (heading) setActive(heading);
    };
    sync();
    const root = document.getElementById('root');
    if (!root) return;
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.body.classList.add('mobile-screen-menu-open');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('mobile-screen-menu-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openScreen(label: string) {
    const target = findScreenButton(label);
    if (!target) return;
    target.click();
    setActive(label);
    setOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      <button
        type="button"
        className={`mobile-screen-menu-trigger ${open ? 'active' : ''}`}
        aria-label="Tüm Taso ekranlarını aç"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span /><span /><span />
      </button>

      {open && (
        <div className="mobile-screen-sheet" role="dialog" aria-modal="true" aria-label="Taso ekranları">
          <button className="mobile-screen-sheet-backdrop" type="button" aria-label="Menüyü kapat" onClick={() => setOpen(false)} />
          <section className="mobile-screen-sheet-panel">
            <header>
              <div><span>TASO</span><strong>Tüm ekranlar</strong><small>{active}</small></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Kapat">×</button>
            </header>
            <div className="mobile-screen-grid">
              {screens.map(([label, description], index) => (
                <button
                  type="button"
                  key={label}
                  className={active === label ? 'active' : ''}
                  onClick={() => openScreen(label)}
                >
                  <span className="mobile-screen-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mobile-screen-copy"><strong>{label}</strong><small>{description}</small></span>
                  <span className="mobile-screen-arrow">↗</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
