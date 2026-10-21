import { useEffect, useState, type FormEvent } from 'react';
import { navigateTaso } from './navigation';

type Project={id:string;name:string;repository:string;lifecycleStatus?:string};
type Risk='READ'|'WRITE'|'HIGH_IMPACT';
type Health={ok?:boolean};
const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');
async function request<T>(path:string,init:RequestInit={},signal?:AbortSignal):Promise<T>{
 const response=await fetch(API+path,{...init,credentials:'same-origin',cache:'no-store',signal,headers:{accept:'application/json','content-type':'application/json',...(init.headers||{})}});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error((payload as {error?:string}).error||(response.status===401?'Oturum sona erdi. Yeniden giriş yap.':path+' HTTP '+response.status));
 return payload as T;
}
export default function WorkspaceAssignRoute(){
 const [projects,setProjects]=useState<Project[]>([]);
 const [projectId,setProjectId]=useState('');
 const [objective,setObjective]=useState('');
 const [risk,setRisk]=useState<Risk>('WRITE');
 const [autonomous,setAutonomous]=useState(true);
 const [coreReady,setCoreReady]=useState(false);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void Promise.all([
   request<{projects:Project[]}>('/v1/projects',{},controller.signal),
   request<Health>('/health',{},controller.signal),
  ]).then(([projectPayload,health])=>{
   if(controller.signal.aborted)return;
   const active=(projectPayload.projects||[]).filter(p=>(p.lifecycleStatus||'active')==='active');
   setProjects(active);setProjectId(active[0]?.id||'');setCoreReady(health.ok===true);
  }).catch(cause=>{if(!controller.signal.aborted)setError((cause as Error).message)})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[]);
 async function submit(event:FormEvent){
  event.preventDefault();const clean=objective.trim();
  if(!clean||!projectId||!coreReady||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   await request('/v1/missions',{method:'POST',body:JSON.stringify({projectId,objective:clean,riskLevel:risk,dataClass:'private_code',autonomous:{enabled:autonomous,previewRequired:true,production:'ask',destructive:'ask'}})});
   setObjective('');setNotice('Görev TASO Core’a iletildi. Güncel durumunu Görevler ekranından izleyebilirsin.');
  }catch(cause){setError((cause as Error).message)}
  finally{setBusy(false)}
 }
 return <section className="tn-assign" aria-labelledby="tn-assign-title">
  <header className="tn-assign__hero"><div><span className="tn-eyebrow">TASO WORKSPACE / GÖREV</span><h2 id="tn-assign-title">İşi tarif et.<br/><em>TASO yürütmeyi üstlensin.</em></h2><p>Bu form gerçek TASO Core görev API’sini kullanır. Görev riskine ve mevcut onay kurallarına uyulur; üretim ve yıkıcı işlemler otomatik onaylanmaz.</p></div><div className={coreReady?'tn-assign__health is-ready':'tn-assign__health'}><span/>{loading?'Core kontrol ediliyor':coreReady?'Core erişilebilir':'Core doğrulanamadı'}</div></header>
  <div className="tn-assign__layout">
   <form className="tn-assign__form" onSubmit={submit}>
    <label htmlFor="tn-assign-project">Proje</label>
    <select id="tn-assign-project" value={projectId} onChange={e=>setProjectId(e.target.value)} disabled={loading||busy||!projects.length} required>
     {projects.length?projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>):<option value="">Aktif proje yok</option>}
    </select>
    <label htmlFor="tn-assign-objective">Hedef ve kabul koşulları</label>
    <textarea id="tn-assign-objective" value={objective} onChange={e=>setObjective(e.target.value)} rows={6} maxLength={12000} placeholder="Ne yapılmalı? Beklenen sonuç, kapsam ve doğrulama koşullarını yaz…" required/>
    <div className="tn-assign__field-hint">Net kapsam ve test edilebilir kabul koşulları yaz. Hassas anahtarları veya parolaları buraya ekleme.</div>
    <label htmlFor="tn-assign-risk">İşlem riski</label>
    <select id="tn-assign-risk" value={risk} onChange={e=>setRisk(e.target.value as Risk)} disabled={busy}>
     <option value="READ">Salt okuma — analiz ve raporlama</option><option value="WRITE">Değişiklik — kod ve test</option><option value="HIGH_IMPACT">Yüksek etki — ek insan onayı gerekir</option>
    </select>
    <label className="tn-assign__toggle"><input type="checkbox" checked={autonomous} onChange={e=>setAutonomous(e.target.checked)} disabled={busy}/><span><strong>Otonom yürütme</strong><small>Planlama, kod değişikliği ve test adımlarını TASO yönetsin. Production/yıkıcı işlemler ayrıca onay ister.</small></span></label>
    {error&&<div className="tn-assign__message is-error" role="alert">{error}</div>}
    {notice&&<div className="tn-assign__message is-success" role="status">{notice}<button type="button" onClick={()=>navigateTaso('Tasks')}>Görevleri izle ↗</button></div>}
    <button className="tn-assign__submit" type="submit" disabled={loading||busy||!coreReady||!projectId||!objective.trim()}>{busy?'Core’a gönderiliyor…':'Görevi TASO’ya ilet'} <span aria-hidden="true">↗</span></button>
   </form>
   <aside className="tn-assign__guardrails"><span>YÜRÜTME SINIRLARI</span><ul><li>Görevler seçilen projeye bağlanır.</li><li>Üretim dağıtımı için ayrı onay kapısı korunur.</li><li>Core erişilemiyorsa görev gönderimi kapalı kalır.</li><li>Başarılı gönderim, görevin tamamlandığı anlamına gelmez; durum Görevler ekranından izlenir.</li></ul><button type="button" onClick={()=>navigateTaso('Task History')}>Görev geçmişini aç ↗</button></aside>
  </div>
 </section>;
}
