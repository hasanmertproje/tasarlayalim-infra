import {useCallback,useEffect,useMemo,useState} from 'react';
import {useAuthSession} from './AuthGateV17';
import {navigateTaso} from './navigation';
import NextOrb from './NextOrb';

type Project={id:string;name:string;slug:string;repository:string;lifecycleStatus?:string};
type Mission={id:string;projectId:string;objective:string;status:string;updatedAt?:string;riskLevel?:string;execution?:{currentAction?:string}};
type Agent={id:string;label:string;status:string;role?:string};
type Operations={agents:Agent[];activity:{id:string;message:string;projectId:string;createdAt:string}[]};
type Snapshot={projects:Project[];missions:Mission[];operations:Operations|null;at:string};
const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');
const ACTIVE=new Set(['queued','planning','running','testing','waiting_approval','preview_ready']);
const STATUS:Record<string,string>={queued:'Kuyrukta',planning:'Planlanıyor',running:'Çalışıyor',testing:'Test ediliyor',waiting_approval:'Onay bekliyor',preview_ready:'Önizleme hazır',completed:'Tamamlandı',failed:'Başarısız',cancelled:'İptal edildi'};
async function get<T>(path:string,signal:AbortSignal):Promise<T>{
  const response=await fetch(API+path,{credentials:'same-origin',cache:'no-store',signal,headers:{accept:'application/json'}});
  if(!response.ok)throw new Error(response.status===401?'Oturum sona erdi. Yeniden giriş yap.':path+' HTTP '+response.status);
  return response.json() as Promise<T>;
}
function shortTime(date?:string){
  if(!date)return 'Tarih yok';
  const ts=Date.parse(date);return Number.isFinite(ts)?new Date(ts).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}):'Tarih yok';
}
export default function NextWorkspace(){
  const {session}=useAuthSession();
  const [data,setData]=useState<Snapshot|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [refreshKey,setRefreshKey]=useState(0);
  const refresh=useCallback(()=>setRefreshKey(x=>x+1),[]);
  useEffect(()=>{
    const controller=new AbortController();
    const load=async()=>{
      try {
        const [p,m,o]=await Promise.all([
          get<{projects:Project[]}>('/v1/projects',controller.signal),
          get<{missions:Mission[]}>('/v1/missions',controller.signal),
          get<{operations:Operations}>('/v1/operations?limit=12',controller.signal),
        ]);
        if(controller.signal.aborted)return;
        setData({projects:p.projects||[],missions:m.missions||[],operations:o.operations||null,at:new Date().toISOString()});
        setError('');
      }catch(e){if(!controller.signal.aborted){setError((e as Error).message);setData(null)}}
      finally{if(!controller.signal.aborted)setLoading(false)}
    };
    setLoading(true);
    void load();
    const timer=window.setInterval(()=>{if(!document.hidden)void load()},30000);
    return()=>{controller.abort();window.clearInterval(timer)};
  },[refreshKey]);
  const projects=useMemo(()=>data?.projects.filter(p=>(p.lifecycleStatus||'active')==='active')||[],[data]);
  const missions=data?.missions||[];
  const active=missions.filter(m=>ACTIVE.has(m.status));
  const approvals=missions.filter(m=>m.status==='waiting_approval');
  const completed=missions.filter(m=>m.status==='completed');
  const recent=[...missions].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5);
  const projectName=(id:string)=>projects.find(p=>p.id===id)?.name||'İlgili proje';
  const go=(screen:'Projects'|'Tasks'|'Approvals'|'Command Center'|'Knowledge')=>navigateTaso(screen);
  return <section className="tn-workspace" aria-label="TASO Çalışma Alanı">
    <header className="tn-workspace__welcome">
      <span className="tn-eyebrow">TASO / ÇALIŞMA ALANI</span>
      <div className="tn-workspace__welcome-row">
        <div><h1>Birlikte <em>üretiyoruz.</em></h1>
          <p>Projelerini, görevlerini ve TASO'nun gerçek çalışmalarını aynı yerden takip et.</p>
          <span className="tn-workspace__identity" title={session.email||'Oturum'}>{session.email||'Oturum doğrulandı'}</span>
        </div>
        <button type="button" className="tn-soft-action" onClick={refresh} disabled={loading} aria-label="Çalışma alanını yenile">↻ {loading?'Yükleniyor':'Verileri yenile'}</button>
      </div>
    </header>
    <section className="tn-workspace__hero" aria-label="TASO ile beraber yapalım">
      <div className="tn-workspace__hero-copy">
        <span className="tn-hero-kicker"><span aria-hidden="true">✦</span> TASO WORKSPACE</span>
        <h2>Bir fikrin var.<br/><span>TASO yanında.</span></h2>
        <p>Proje bağlamına bağlı gerçek konuşmalara ve görev yürütmeye mevcut TASO Core üzerinden devam et.</p>
        <div className="tn-workspace__hero-actions">
          <button type="button" className="tn-primary-action" onClick={()=>go('Command Center')}>TASO ile çalış <span aria-hidden="true">↗</span></button>
          <button type="button" className="tn-ghost-action" onClick={()=>go('Projects')}>Projeleri aç</button>
        </div>
      </div>
      <NextOrb size="large" className="tn-workspace__hero-orb"/>
      <aside className="tn-workspace__today" aria-label="Güncel işler">
        <strong>BUGÜNKÜ GÖRÜNÜM</strong>
        <span><b>{data?active.length:'—'}</b> Devam eden görev</span>
        <span><b>{data?approvals.length:'—'}</b> Onay bekliyor</span>
        <span><b>{data?completed.length:'—'}</b> Tamamlanan görev</span>
        <small>Canlı Core kayıtlarından</small>
      </aside>
    </section>
    {error&&<div role="alert" className="tn-workspace__error"><strong>Veriler alınamadı.</strong> {error} <button type="button" onClick={refresh}>Yeniden dene</button></div>}
    <div className="tn-workspace__metrics" aria-label="Gerçek proje ve görev sayıları">
      {[
        {label:'Aktif projeler',value:data?projects.length:'—',detail:'Projeler',to:'Projects' as const,tone:'blue'},
        {label:'Devam eden işler',value:data?active.length:'—',detail:'Görevler',to:'Tasks' as const,tone:'purple'},
        {label:'Tamamlanan işler',value:data?completed.length:'—',detail:'Görevler',to:'Tasks' as const,tone:'mint'},
        {label:'Onay kararları',value:data?approvals.length:'—',detail:'Onaylar',to:'Approvals' as const,tone:'amber'},
      ].map(m=><button className={'tn-workspace__metric tn-workspace__metric--'+m.tone} type="button" key={m.label} onClick={()=>go(m.to)}>
        <span>{m.label}</span><strong>{m.value}</strong><small>{m.detail} <span aria-hidden="true">↗</span></small>
      </button>)}
    </div>
    <div className="tn-workspace__grid">
      <section className="tn-workspace__panel tn-workspace__projects"><header><div><span className="tn-eyebrow">PROJE EVRENİ</span><h3>Projelerim</h3></div><button type="button" onClick={()=>go('Projects')}>Tümünü gör ↗</button></header>
        <div className="tn-workspace__project-grid">
          {projects.slice(0,3).map((p,index)=><button className="tn-workspace__project" type="button" key={p.id} onClick={()=>go('Projects')}>
            <div className={'tn-workspace__project-art tn-workspace__project-art--'+index} aria-hidden="true"><NextOrb size="small"/></div>
            <strong>{p.name}</strong><small title={p.repository}>{p.repository}</small>
            <span>{missions.filter(m=>m.projectId===p.id&&ACTIVE.has(m.status)).length} aktif görev <span aria-hidden="true">↗</span></span>
          </button>)}
          {!loading&&!projects.length&&<div className="tn-workspace__empty">Henüz aktif proje yok. <button type="button" onClick={()=>go('Projects')}>Yeni proje oluştur →</button></div>}
          {loading&&<p className="tn-workspace__empty">Projeler yükleniyor…</p>}
        </div>
      </section>
      <section className="tn-workspace__panel tn-workspace__tasks"><header><div><span className="tn-eyebrow">CANLI GÖREV DURUMU</span><h3>Son görevler</h3></div><button type="button" onClick={()=>go('Tasks')}>Tümünü gör ↗</button></header>
        <div className="tn-workspace__task-list">
          {recent.map(m=><button type="button" key={m.id} onClick={()=>go('Tasks')}><span className={'tn-workspace__task-dot tn-workspace__task-dot--'+(m.status==='completed'?'done':m.status==='failed'?'failed':'active')} aria-hidden="true"/><span><strong>{m.objective}</strong><small>{projectName(m.projectId)} · {shortTime(m.updatedAt)}</small></span><em>{STATUS[m.status]||m.status}</em></button>)}
          {!loading&&!recent.length&&<p className="tn-workspace__empty">Henüz kayıtlı görev yok.</p>}
        </div>
      </section>
      <section className="tn-workspace__panel tn-workspace__shortcuts"><header><div><span className="tn-eyebrow">TASO İLE BİRLİKTE</span><h3>Buradan devam et</h3></div></header>
        <div className="tn-workspace__shortcut-grid">
          <button type="button" onClick={()=>go('Command Center')}><span>✦</span><strong>Beraber çalış</strong><small>Proje bağlamlı sohbet ve görev</small></button>
          <button type="button" onClick={()=>go('Projects')}><span>▣</span><strong>Proje yönet</strong><small>Repo, teknoloji, bağlam</small></button>
          <button type="button" onClick={()=>go('Knowledge')}><span>◈</span><strong>Bilgi merkezi</strong><small>Proje verilerin</small></button>
          <button type="button" onClick={()=>go('Tasks')}><span>☑</span><strong>Görevleri izle</strong><small>Gerçek Core durumları</small></button>
        </div>
      </section>
    </div>
    <footer className="tn-workspace__foot">Son senkronizasyon: {data?shortTime(data.at):'Bekleniyor'} · Gösterilen sayılar simülasyon değildir · Bu alan mevcut oturum izinleriyle çalışır</footer>
  </section>;
}
