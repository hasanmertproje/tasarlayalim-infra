import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAuthSession } from './AuthGateV17';
import { TASO_PRIMARY_SCREENS, TASO_SCREEN_LABELS, type TasoScreen, useTasoNavigation } from './navigation';

type Theme = 'dark' | 'light';
const ICON_PATHS: Record<string, string> = {
  'Command Center':'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  Projects:'M3 7h18v13H3zM3 7V4h7l2 3',Tasks:'M4 6h2m4 0h10M4 12h2m4 0h10M4 18h2m4 0h10',
  Approvals:'M12 2 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6zM8 12l3 3 5-6',
  Deployments:'M12 2 4 6v14l8-4 8 4V6zM4 6l8 5 8-5M12 11v5',
  'AI Agents':'M8 3h8M12 3v3M4 9h16v11H4zM8 14h.01M16 14h.01M9 18h6',
  Knowledge:'M4 4h7a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H4zM20 4h-5a4 4 0 0 0-4 4',
  Integrations:'M8 3v5M16 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3',
  Monitoring:'M3 12h4l3-7 4 14 3-7h4',Settings:'M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4',
  Notifications:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4',Infrastructure:'M3 4h18v7H3zM3 13h18v7H3zM7 8h.01M7 17h.01',
};
export function NavGlyph({screen}:{screen:TasoScreen}) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_PATHS[screen]}/></svg>;
}
function initialTheme():Theme {
  try { const saved=localStorage.getItem('taso-theme'); if(saved==='dark'||saved==='light')return saved; }catch{}
  return 'dark';
}
export default function DashboardShellV2({children}:{children:ReactNode}) {
  const [screen,navigate]=useTasoNavigation();
  const {session,logout}=useAuthSession();
  const [theme,setTheme]=useState<Theme>(initialTheme);
  const [expanded,setExpanded]=useState(()=>localStorage.getItem('taso-sidebar-expanded')!=='false');
  const [menuOpen,setMenuOpen]=useState(false);
  const closeRef=useRef<HTMLButtonElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    document.documentElement.style.colorScheme=theme;
    localStorage.setItem('taso-theme',theme);
  },[theme]);
  useEffect(()=>{setMenuOpen(false)},[screen]);
  useEffect(()=>{
    if(!menuOpen)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenuOpen(false)};
    document.body.classList.add('taso-shell-drawer-open');
    window.addEventListener('keydown',escape);
    closeRef.current?.focus();
    return()=>{document.body.classList.remove('taso-shell-drawer-open');window.removeEventListener('keydown',escape);triggerRef.current?.focus({preventScroll:true})};
  },[menuOpen]);
  const go=(target:TasoScreen)=>{navigate(target);setMenuOpen(false)};
  function mobileVoice(){
    if(screen!=='Command Center'){
      // Switching routes unmounts the chat; never simulate a later permission gesture.
      go('Command Center');
      return;
    }
    const mic=document.querySelector<HTMLButtonElement>('.dashboard-chat .dashboard-chat-mic');
    if(mic&&!mic.disabled)mic.click();
  }
  const item=(target:TasoScreen)=><button key={target} type="button" className={screen===target?'ds2-link is-active':'ds2-link'} onClick={()=>go(target)} aria-current={screen===target?'page':undefined} title={TASO_SCREEN_LABELS[target]}><NavGlyph screen={target}/><span>{TASO_SCREEN_LABELS[target]}</span><i aria-hidden="true"/></button>;
  return <div className={expanded?'ds2-shell ds2-expanded':'ds2-shell'} data-screen={screen}>
    <aside className="ds2-sidebar" aria-label="Uygulama menüsü">
      <div className="ds2-identity"><div className="ds2-mark" aria-hidden="true"><span>T</span><i/></div><div className="ds2-identity-text"><strong>TASO</strong><span>OPERASYON SİSTEMİ</span></div></div>
      <nav className="ds2-links" aria-label="Ana menü">{TASO_PRIMARY_SCREENS.map(item)}</nav>
      <div className="ds2-sidebar-foot"><div className="ds2-foot-label">ÇALIŞMA ALANI</div><button type="button" onClick={()=>setExpanded(v=>{localStorage.setItem('taso-sidebar-expanded',String(!v));return !v})} className="ds2-collapse" aria-label={expanded?'Menüyü daralt':'Menüyü genişlet'} aria-expanded={expanded}>{expanded?'‹ Daralt':'›'}</button></div>
    </aside>
    <div className="ds2-content">
      <header className="ds2-header"><div className="ds2-breadcrumb"><span>TASO / OPERASYON</span><h1>{TASO_SCREEN_LABELS[screen]}</h1></div><div className="ds2-header-actions"><button type="button" className="ds2-action" onClick={()=>go('Notifications')} aria-label="Bildirimler" title="Bildirimler"><NavGlyph screen="Notifications"/></button><button type="button" className="ds2-action" onClick={()=>setTheme(v=>v==='dark'?'light':'dark')} aria-label={theme==='dark'?'Açık temaya geç':'Koyu temaya geç'} title={theme==='dark'?'Açık tema':'Koyu tema'}>{theme==='dark'?'☼':'☾'}</button><div className="ds2-session"><span title={session.email||'Oturum'}>{session.email||'Kullanıcı'}</span><button type="button" onClick={()=>void logout()}>Çıkış</button></div></div></header>
      <main className="ds2-main" id="taso-main">{children}</main>
    </div>
    <nav className="ds2-bottom" aria-label="Mobil ana menü">
      {(['Command Center','Projects'] as TasoScreen[]).map(target=><button key={target} type="button" className={screen===target?'is-active':''} aria-current={screen===target?'page':undefined} onClick={()=>go(target)}><NavGlyph screen={target}/><span>{target==='Command Center'?'Kontrol':TASO_SCREEN_LABELS[target]}</span></button>)}
      <button type="button" className="ds2-voice" onClick={mobileVoice} aria-label={screen==='Command Center'?'TASO Voice ile konuş':'TASO Voice ekranına git'} title="TASO Voice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" width="22" height="22" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg><span>Ses</span></button>
      <button type="button" className={screen==='Tasks'?'is-active':''} aria-current={screen==='Tasks'?'page':undefined} onClick={()=>go('Tasks')}><NavGlyph screen="Tasks"/><span>Görevler</span></button>
      <button ref={triggerRef} type="button" onClick={()=>setMenuOpen(true)} aria-label="Tüm menüyü aç" aria-expanded={menuOpen} aria-controls="ds2-drawer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menü</span></button>
    </nav>
    {menuOpen&&<div className="ds2-drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMenuOpen(false)}}><section className="ds2-drawer" id="ds2-drawer" role="dialog" aria-modal="true" aria-label="Tüm sayfalar"><header><strong>Sayfalar</strong><button ref={closeRef} type="button" onClick={()=>setMenuOpen(false)} aria-label="Menüyü kapat">×</button></header><nav aria-label="Tüm sayfalar">{[...TASO_PRIMARY_SCREENS,'Notifications','Infrastructure'].map(target=>item(target as TasoScreen))}</nav><div className="ds2-drawer-bottom"><span>{session.email||'Oturum'}</span><button type="button" onClick={()=>void logout()}>Çıkış</button></div></section></div>}
  </div>;
}
