import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {navigateTaso} from './navigation';
import DashboardChat from './DashboardChat';
import NextOrb from './NextOrb';

type Project={id:string;name:string;repository:string;lifecycleStatus?:string};
type Mission={id:string;projectId:string;objective:string;status:string};
type StudioMetadata={version:number;pages:{id:string;name:string}[]};
type Risk='READ'|'WRITE'|'HIGH_IMPACT';
const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');
async function read<T>(path:string,signal?:AbortSignal):Promise<T>{
 const response=await fetch(API+path,{credentials:'same-origin',cache:'no-store',signal,headers:{accept:'application/json'}});
 if(!response.ok)throw new Error(response.status===403?'Proje erişimi sunucu tarafından reddedildi.':'Core erişimi HTTP '+response.status);
 return response.json() as Promise<T>;
}
export default function ProjectCoWork(){
 const [projects,setProjects]=useState<Project[]>([]);
 const [projectId,setProjectId]=useState('');
 const [missions,setMissions]=useState<Mission[]>([]);
 const [studio,setStudio]=useState<StudioMetadata|null>(null);
 const [studioStatus,setStudioStatus]=useState('Henüz kontrol edilmedi');
 const [searchReady,setSearchReady]=useState(false);
 const [canWrite,setCanWrite]=useState(false);
 const [loading,setLoading]=useState(true);
 const [sending,setSending]=useState(false);
 const [objective,setObjective]=useState('');
 const [risk,setRisk]=useState<Risk>('READ');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [refreshIndex,setRefreshIndex]=useState(0);
 const refresh=useCallback(()=>setRefreshIndex(x=>x+1),[]);
 useEffect(()=>{const c=new AbortController();setLoading(true);setError('');
  const load=async()=>{try{
   const [p,m,me,research]=await Promise.all([
    read<{projects:Project[]}>('/v1/projects',c.signal),
    read<{missions:Mission[]}>('/v1/missions',c.signal),
    fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store',signal:c.signal}).then(async r=>r.ok?r.json():{permissions:[]}),
    read<{research:{searchReady?:boolean}}>('/v1/research/status',c.signal).catch(()=>({research:{searchReady:false}}))
   ]);
   if(c.signal.aborted)return;
   const live=(p.projects||[]).filter(x=>(x.lifecycleStatus||'active')==='active');
   setProjects(live);setMissions(m.missions||[]);
   const permissions:Array<string>=Array.isArray(me.permissions)?me.permissions:[];
   setCanWrite(permissions.includes('missions.write'));
   setSearchReady(Boolean(research.research?.searchReady));
   const preferred=sessionStorage.getItem('taso-focus-project');
   setProjectId(previous=>live.some(x=>x.id===previous)?previous:live.find(x=>x.id===preferred)?.id||live[0]?.id||'');
  }catch(e){if(!c.signal.aborted)setError((e as Error).message)}
  finally{if(!c.signal.aborted)setLoading(false)}};
  void load();return()=>c.abort();
 },[refreshIndex]);
 useEffect(()=>{if(!projectId){setStudio(null);setStudioStatus('Önce proje seçin');return}
  const c=new AbortController();setStudioStatus('Studio belgesi kontrol ediliyor…');
  void read<{document:StudioMetadata|null}>('/v1/projects/'+encodeURIComponent(projectId)+'/studio',c.signal).then(result=>{
    if(c.signal.aborted)return;
    setStudio(result.document);setStudioStatus(result.document?'Core üzerinde kayıtlı':'Studio belgesi henüz oluşturulmadı');
  }).catch(()=>{if(!c.signal.aborted){setStudio(null);setStudioStatus('Studio durumuna erişilemiyor')}});return()=>c.abort();
 },[projectId,refreshIndex]);
 const project=projects.find(x=>x.id===projectId);
 const current=missions.filter(x=>x.projectId===projectId);
 function openStudio(){if(!projectId)return;sessionStorage.setItem('taso-studio-project',projectId);navigateTaso('Studio')}
 async function createMission(event:FormEvent){event.preventDefault();const value=objective.trim();
  if(!projectId||!value||!canWrite||sending)return;
  setSending(true);setError('');setNotice('');
  try{
    const response=await fetch(API+'/v1/missions',{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({projectId,objective:value,riskLevel:risk,dataClass:'private_code',
        autonomous:{enabled:false,previewRequired:true,production:'ask',destructive:'ask'}})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'Görev başlatılamadı (HTTP '+response.status+').');
    if(!payload.mission?.id)throw new Error('Core yeni görev kimliği döndürmedi; işlem doğrulanamadı.');
    setObjective('');setNotice('Görev TASO Core üzerinde oluşturuldu. Görevler ekranından gerçek ilerlemeyi takip edebilirsin.');
    const fresh=await read<{missions:Mission[]}>('/v1/missions');setMissions(fresh.missions||[]);
  }catch(e){setError((e as Error).message)}
  finally{setSending(false)}
 }
 return <section className="taso-cowork" aria-label="TASO ile Beraber Yapalım">
  <header className="cowork-head"><div><span className="tn-eyebrow">TASO / PROJE BAĞLAMLI ÇALIŞMA</span><h1>TASO ile beraber <em>yapalım.</em></h1>
   <p>Konuş, karar ver, kontrollü görev başlat ve aynı projenin tasarım belgesini aç. Bütün işlemler gerçek Core kaynaklarını kullanır.</p></div><NextOrb size="medium"/></header>
  <div className="cowork-context"><label htmlFor="cowork-project">Çalışılacak proje
    <select id="cowork-project" value={projectId} onChange={e=>{setProjectId(e.target.value);setError('');setNotice('')}} disabled={loading||!projects.length}>
     {projects.length?projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>):<option value="">Aktif proje bulunamadı</option>}
    </select>
   </label><button type="button" onClick={refresh} disabled={loading}>↻ Yenile</button>
   <button type="button" onClick={openStudio} disabled={!projectId}>Studio'yu aç ↗</button>
  </div>
  {error&&<div className="cowork-error" role="alert">{error}</div>}
  {notice&&<div className="cowork-notice" role="status">{notice}</div>}
  <div className="cowork-layout">
   <section className="cowork-talk cc30-conversation" aria-label="Projeye bağlı gerçek sohbet">
    <div className="cowork-section-head"><span>01 / BİRLİKTE DÜŞÜNELİM</span><h2>{project?.name||'Proje bekleniyor'}</h2><p>Sohbet geçmişi ve yanıtları TASO Core üzerinden gelir; hizmet kullanılamıyorsa hata açıkça gösterilir.</p></div>
    <DashboardChat projectId={projectId} searchReady={searchReady}/>
   </section>
   <aside className="cowork-rail">
    <section className="cowork-panel"><div className="cowork-section-head"><span>02 / PROJE DOSYASI</span><h2>Bağlam ve tasarım</h2></div>
     <dl><div><dt>Repository</dt><dd>{project?.repository||'—'}</dd></div><div><dt>Studio sürümü</dt><dd>{studio?'v'+studio.version:studioStatus}</dd></div><div><dt>Kaydedilmiş sayfa</dt><dd>{studio?studio.pages.length:'—'}</dd></div><div><dt>Kayıtlı görev</dt><dd>{project?current.length:'—'}</dd></div></dl>
     <button type="button" disabled={!projectId} onClick={openStudio}>Bu projeyi Studio'da düzenle ↗</button>
    </section>
    <section className="cowork-panel cowork-mission"><div className="cowork-section-head"><span>03 / TASO'YU GÖREVLENDİR</span><h2>Kontrollü görev</h2><p>Konuşma tek başına görev başlatmaz; bu form gerçek Core görev kaydı oluşturur.</p></div>
     <form onSubmit={createMission}><label htmlFor="cowork-objective">Ne yapılmasını istiyorsun?</label>
      <textarea id="cowork-objective" value={objective} onChange={e=>setObjective(e.target.value)} rows={4} maxLength={16000} placeholder="Örn. Seçili projenin mobil menüsündeki sorunları incele." disabled={!projectId||sending||!canWrite}/>
      <label htmlFor="cowork-risk">Risk ve işlem kapsamı</label><select id="cowork-risk" value={risk} onChange={e=>setRisk(e.target.value as Risk)} disabled={!canWrite}>
       <option value="READ">Salt okuma</option><option value="WRITE">Kod değişikliği · mevcut politika</option><option value="HIGH_IMPACT">Yüksek etki · onay gerekir</option></select>
      <p>Otomatik production dağıtımı kapalıdır; yıkıcı işlemler insan onayı gerektirir.</p>
      <button type="submit" disabled={!canWrite||!projectId||!objective.trim()||sending}>{sending?'Görev kaydediliyor…':'Core üzerinde görev başlat →'}</button>
      {!canWrite&&<small>Bu oturumda görev yazma izni bulunmuyor; API erişimi de sunucuda doğrulanır.</small>}
     </form>
    </section>
    <button type="button" className="cowork-to-tasks" onClick={()=>navigateTaso('Tasks')}>Gerçek görevleri ve onay durumlarını aç ↗</button>
   </aside>
  </div>
 </section>;
}
