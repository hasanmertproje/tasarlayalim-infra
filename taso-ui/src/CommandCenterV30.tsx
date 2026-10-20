import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardChat from './DashboardChat';
import NextOrb from './NextOrb';
import { navigateTaso } from './navigation';

type Project={id:string;name:string;slug:string;repository:string;lifecycleStatus?:string};
type Mission={id:string;projectId:string;objective:string;status:string;riskLevel?:Risk;updatedAt?:string;execution?:{progressPercent?:number;currentAction?:string;activeAgentRole?:string;previewUrl?:string;pullRequestUrl?:string;productionUrl?:string;blockedReason?:string;checkState?:string}};
type Risk='READ'|'WRITE'|'HIGH_IMPACT';
type Agent={id:string;label:string;status:string;role?:string;missionId?:string;detail?:string};
type Activity={id:string;projectId:string;projectName:string;message:string;missionStatus:string;createdAt:string};
type Operations={generatedAt:string;agents:Agent[];activity:Activity[];projects:{projectId:string;activeMissions:number;failedMissions:number;waitingApproval:number}[]};
type Health={ok?:boolean;version?:string;executor?:{read?:boolean;write?:boolean;deploy?:boolean}};
type Research={fetchReady?:boolean;searchReady?:boolean};
type Capability={id:string;state:'ready'|'limited'|'not-configured'|'unavailable'};
type VoiceStatus={realtime?:{ready?:boolean;provider?:string};providers?:{geminiTts?:{ready?:boolean};openai?:{ready?:boolean}}};
const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');
const ACTIVE=new Set(['queued','planning','running','testing','waiting_approval','preview_ready']);
const statusMap:Record<string,string>={queued:'Kuyrukta',planning:'Planlanıyor',running:'Çalışıyor',testing:'Doğrulanıyor',waiting_approval:'Onay bekliyor',preview_ready:'Önizleme hazır',completed:'Tamamlandı',failed:'Hata',cancelled:'İptal edildi'};
const riskMap:Record<Risk,string>={READ:'Salt okuma',WRITE:'Değişiklik yapabilir',HIGH_IMPACT:'Yüksek etki · onay gerekir'};
const stateMap:Record<Capability['state'],string>={ready:'Hazır',limited:'Kısıtlı','not-configured':'Yapılandırılmadı',unavailable:'Erişilemiyor'};
const agentLabels:Record<string,string>={
 'AI Planner':'Yapay Zekâ Planlayıcısı',
 'Mission Executor':'Görev Yürütücüsü',
 'Planning Watchdog':'Planlama Gözcüsü',
 'GitHub Broker':'GitHub Bağlayıcısı',
 'Coolify Broker':'Coolify Dağıtım Bağlayıcısı',
};

const relative=(date?:string)=>{if(!date)return'—';const n=Date.parse(date);if(!Number.isFinite(n))return'—';const m=Math.max(0,Math.floor((Date.now()-n)/60000));return m<1?'Az önce':m<60?`${m} dk önce`:m<1440?`${Math.floor(m/60)} sa önce`:new Date(n).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'})};
const status=(code?:string)=>code?(statusMap[code]||'Bilinmeyen durum'):'Görev yok';
function safeExternal(value?:string){if(!value)return undefined;try{const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.href:undefined}catch{return undefined}}
async function get<T>(path:string,signal?:AbortSignal):Promise<T>{const r=await fetch(API+path,{credentials:'same-origin',cache:'no-store',signal,headers:{accept:'application/json'}});if(!r.ok)throw new Error(r.status===401?'Oturum geçersiz. Yeniden giriş yap.':`API ${r.status}: ${path}`);return r.json() as Promise<T>}
async function post<T>(path:string,body:unknown):Promise<T>{const r=await fetch(API+path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Görev başlatılamadı (${r.status})`);return data as T}
function Gauge({label,value,detail}:{label:string;value:string|number;detail:string}){return <div className="cc30-gauge"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>}
export default function CommandCenterV30(){
 const [projects,setProjects]=useState<Project[]>([]),[missions,setMissions]=useState<Mission[]>([]),[operations,setOperations]=useState<Operations|null>(null);
 const [health,setHealth]=useState<Health|null>(null),[research,setResearch]=useState<Research|null>(null),[capabilities,setCapabilities]=useState<Capability[]|null>(null),[voice,setVoice]=useState<VoiceStatus|null>(null);
 const [projectId,setProjectId]=useState(''),[objective,setObjective]=useState(''),[risk,setRisk]=useState<Risk>('WRITE'),[mode,setMode]=useState<'assisted'|'autonomous'>('autonomous');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[lastSync,setLastSync]=useState<string|null>(null);
 const pendingRequest=useRef<AbortSignal|'manual'|null>(null),submitRequest=useRef(false);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  if(pendingRequest.current&&(pendingRequest.current==='manual'||!pendingRequest.current.aborted))return;
  const requestKey=signal||'manual';pendingRequest.current=requestKey;
  try{
   const [p,m,o,h,r,c,v]=await Promise.all([
    get<{projects:Project[]}>('/v1/projects',signal),get<{missions:Mission[]}>('/v1/missions',signal),
    get<{operations:Operations}>('/v1/operations?limit=15',signal),get<Health>('/health',signal),
    get<{research:Research}>('/v1/research/status',signal).catch(()=>null),
    get<{capabilities:Capability[]}>('/v1/capabilities',signal).catch(()=>null),
    get<VoiceStatus>('/v1/voice/realtime',signal).catch(()=>null),
   ]);
   if(signal?.aborted)return;
   const valid=(p.projects||[]).filter(x=>(x.lifecycleStatus||'active')==='active');
   setProjects(valid);setMissions(m.missions||[]);setOperations(o.operations||null);setHealth(h);setResearch(r?.research||null);setCapabilities(c?.capabilities||null);setVoice(v);
   setProjectId(id=>valid.some(x=>x.id===id)?id:valid[0]?.id||'');setLastSync(new Date().toISOString());setError('');
  }catch(e){if(!signal?.aborted){setError((e as Error).message);setHealth(null);setOperations(null);setCapabilities(null);setResearch(null);setVoice(null)}}
  finally{if(pendingRequest.current===requestKey)pendingRequest.current=null;if(!signal?.aborted)setLoading(false)}
 },[]);
 useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);const timer=window.setInterval(()=>{if(!document.hidden)void refresh(controller.signal)},15000);return()=>{controller.abort();window.clearInterval(timer)}},[refresh]);
 const selected=projects.find(x=>x.id===projectId);
 const projectMissions=useMemo(()=>missions.filter(x=>x.projectId===projectId),[missions,projectId]);
 const current=useMemo(()=>[...projectMissions].filter(x=>ACTIVE.has(x.status)).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0],[projectMissions]);
 const approvals=missions.filter(x=>x.status==='waiting_approval');
 const working=operations?.agents.filter(x=>x.status==='busy')||[];
 const failures=operations?.projects.reduce((n,x)=>n+x.failedMissions,0);
 const coreOk=Boolean(health?.ok&&!error);
 const cap=(id:string,fallback?:boolean):{ready:boolean;label:string}=>{
  const found=capabilities?.find(c=>c.id===id);
  if(found)return{ready:found.state==='ready'&&coreOk,label:coreOk?stateMap[found.state]:'Erişilemiyor'};
  if(!coreOk)return{ready:false,label:loading?'Kontrol ediliyor':'Doğrulanamadı'};
  return{ready:fallback===true,label:fallback===true?'Hazır':'Doğrulanamadı'};
 };
 const browserSpeech=typeof window!=='undefined'&&Boolean((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition);
 const voiceProviderReady=Boolean(voice?.realtime?.ready||voice?.providers?.geminiTts?.ready);
 const capabilityRows=[
  ['Okuma',cap('read',health?.executor?.read)],['Yazma',cap('write',health?.executor?.write)],
  ['Dağıtım',cap('preview-deploy',health?.executor?.deploy)],['Web erişimi',cap('web-fetch',research?.fetchReady)],
  ['Arama',cap('web-search',research?.searchReady)],['Tarayıcı',cap('browser')],
  ['Ses', {ready:coreOk&&(voiceProviderReady||browserSpeech),label:!coreOk?'Doğrulanamadı':voiceProviderReady?'Sağlayıcı bağlı':browserSpeech?'Tarayıcı ile sınırlı':'Desteklenmiyor'}]
 ] as const;
 async function submit(event:FormEvent){event.preventDefault();const value=objective.trim();if(!value||!selected||submitRequest.current||!coreOk)return;submitRequest.current=true;setBusy(true);setError('');
  try{await post('/v1/missions',{projectId:selected.id,objective:value,riskLevel:risk,dataClass:'private_code',autonomous:{enabled:mode==='autonomous',previewRequired:true,production:'ask',destructive:'ask'}});setObjective('');await refresh()}catch(e){setError((e as Error).message)}finally{submitRequest.current=false;setBusy(false)}
 }
 const voiceJump=()=>{const mic=document.querySelector<HTMLButtonElement>('.dashboard-chat .dashboard-chat-mic');if(mic&&!mic.disabled){mic.click();mic.scrollIntoView({behavior:'smooth',block:'center'})}};
 return <section className="cc30" aria-label="Kontrol Merkezi" data-api-ready={coreOk?'true':'false'}>
   <div className="cc30-intro"><div><span className="cc30-kicker"><i/> CANLI OPERASYON GÖRÜNÜMÜ</span><h2>Yapay zekâ operasyonların<br/><span>tek yerde.</span></h2><p>Görevler, onaylar ve sistem yetenekleri. Yalnızca doğrulanmış veriler.</p></div><div className="cc30-intro-orb"><NextOrb size="large"/></div><div className="cc30-project-box"><label htmlFor="cc30-project">Aktif proje</label><select id="cc30-project" value={projectId} onChange={e=>setProjectId(e.target.value)} disabled={!projects.length}>{projects.length?projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>):<option value="">Proje bulunamadı</option>}</select><small title={selected?.repository||''}>{selected?.repository||'Henüz bir proje seçilmedi'}</small></div></div>
   <div className="cc30-status"><span className={coreOk?'cc30-online':'cc30-offline'}><i/>{loading?'Kontrol ediliyor':coreOk?'Core erişilebilir':'Core doğrulanamadı'}</span><span>Son senkron: {relative(lastSync||undefined)}</span><span>{health?.version?`Sürüm ${health.version}`:'Sürüm bilinmiyor'}</span><button type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Verileri yenile">↻ Yenile</button></div>
   {error&&<div className="cc30-error" role="alert">{error}</div>}
   <div className="cc30-gauges"><Gauge label="Aktif görev" value={operations?.projects.reduce((n,p)=>n+p.activeMissions,0)??'—'} detail="Tüm projeler"/><Gauge label="Çalışan ajan" value={operations?.agents?working.length:'—'} detail="Core operasyon verisi"/><Gauge label="Onay bekleyen" value={coreOk?approvals.length:'—'} detail="İnsan kararı"/><Gauge label="Hatalı görev" value={failures??'—'} detail="Core kayıtları"/></div>
   <div className="cc30-columns"><div className="cc30-center">
     <section className="cc30-panel cc30-active"><div className="cc30-panel-head"><div><span className="cc30-eyebrow">01 / ŞİMDİ</span><h3>Güncel operasyon</h3></div><button type="button" onClick={()=>navigateTaso('Tasks')}>Tüm görevler <span aria-hidden="true">↗</span></button></div>
       {current?<><div className="cc30-task-status"><span>{status(current.status)}</span><span>{current.riskLevel?riskMap[current.riskLevel]:'Risk belirtilmedi'}</span></div><h4>{current.objective}</h4><div className="cc30-progress" role="progressbar" aria-label="Görev ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0,Math.min(100,current.execution?.progressPercent||0))}><i style={{width:`${Math.max(0,Math.min(100,current.execution?.progressPercent||0))}%`}}/></div><dl className="cc30-task-details"><div><dt>Son adım</dt><dd>{current.execution?.currentAction||status(current.status)}</dd></div><div><dt>Çalışan ajan</dt><dd>{current.execution?.activeAgentRole||working.find(x=>x.missionId===current.id)?.label||'Atanmadı'}</dd></div><div><dt>Güncelleme</dt><dd>{relative(current.updatedAt)}</dd></div></dl>{current.execution?.blockedReason&&<p className="cc30-error">Engel: {current.execution.blockedReason}</p>}<div className="cc30-links">{([['Önizleme',current.execution?.previewUrl],['Değişiklik isteği',current.execution?.pullRequestUrl]] as const).map(([name,url])=>safeExternal(url)?<a key={name} href={safeExternal(url)} target="_blank" rel="noopener noreferrer">{name} ↗</a>:null)}</div></>:<div className="cc30-empty"><div className="cc30-idle-symbol" aria-hidden="true"><span>T</span></div><div><strong>{loading?'Veriler yükleniyor':coreOk?'Aktif görev bulunmuyor':'Operasyon verisi doğrulanamadı'}</strong><p>{coreOk?'Yeni bir görev başlattığında burada gerçek yürütme adımlarını izleyeceksin.':'Core bağlantısı kurulmadan görev durumu veya ajan aktivitesi varsayılmaz.'}</p></div></div>}
     </section>
     <section className="cc30-panel cc30-compose"><div className="cc30-panel-head"><div><span className="cc30-eyebrow">02 / YENİ GÖREV</span><h3>TASO’ya görev ver</h3></div></div><form onSubmit={submit}><label htmlFor="cc30-objective">Görev tanımı</label><textarea id="cc30-objective" rows={4} maxLength={16000} value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Projede yapılmasını istediğin işi açıklayın…" disabled={!coreOk||busy}/><div className="cc30-form-bottom"><label>Risk seviyesi<select value={risk} onChange={e=>setRisk(e.target.value as Risk)}><option value="READ">Salt okuma</option><option value="WRITE">Değişiklik yapabilir</option><option value="HIGH_IMPACT">Yüksek etki · onay gerekir</option></select></label><label>Çalışma biçimi<select value={mode} onChange={e=>setMode(e.target.value as 'assisted'|'autonomous')}><option value="autonomous">Otonom yürütme</option><option value="assisted">Kontrollü yürütme</option></select></label><button type="submit" disabled={!objective.trim()||!selected||!coreOk||busy}>{busy?'Gönderiliyor…':'Görevi başlat ↗'}</button></div></form><p className="cc30-subnote">Üretim dağıtımı ve yıkıcı işlemler ayrıca onay gerektirir. Önizleme denetimi etkin.</p></section>
     <section className="cc30-panel cc30-conversation"><div className="cc30-panel-head"><div><span className="cc30-eyebrow">03 / TASO VOICE</span><h3>Yazılı ve sesli konuşma</h3></div><button className="cc30-voice-trigger" type="button" onClick={voiceJump} disabled={!selected} aria-label="Sesli konuşmayı başlat veya kapat"><span aria-hidden="true">◉</span> Sesli konuş</button></div><DashboardChat projectId={selected?.id||''} searchReady={Boolean(research?.searchReady)}/></section>
     <section className="cc30-panel cc30-events"><div className="cc30-panel-head"><div><span className="cc30-eyebrow">04 / İŞLEM KAYDI</span><h3>Son hareketler</h3></div><button type="button" onClick={()=>navigateTaso('Monitoring')}>İzleme ↗</button></div>{operations?.activity?.length?operations.activity.slice(0,7).map(a=><div className="cc30-event" key={a.id}><i className={a.missionStatus==='failed'?'is-error':a.missionStatus==='completed'?'is-done':''}/><div><strong>{a.message}</strong><span>{a.projectName} · {relative(a.createdAt)}</span></div></div>):<p className="cc30-muted">Görüntülenecek doğrulanmış hareket bulunmuyor.</p>}</section>
   </div><aside className="cc30-rail">
     <section className="cc30-panel"><div className="cc30-panel-head"><div><span className="cc30-eyebrow">SİSTEM</span><h3>Kabiliyet durumu</h3></div></div><div className="cc30-capabilities">{capabilityRows.map(([name,c])=><div key={name}><span className={c.ready?'cc30-dot is-ready':'cc30-dot'}/><span>{name}</span><strong className={c.ready?'is-ready':''}>{c.label}</strong></div>)}</div><p className="cc30-subnote">Ses: tarayıcı desteği, sağlayıcı hazır olmasından ayrı değerlendirilir.</p></section>
     <section className="cc30-panel"><div className="cc30-panel-head"><div><span className="cc30-eyebrow">KARARLAR</span><h3>Onay bekleyenler</h3></div><button type="button" onClick={()=>navigateTaso('Approvals')}>Tümü ↗</button></div><strong className="cc30-approval-number">{coreOk?approvals.length:'—'}</strong>{approvals.length?approvals.slice(0,3).map(m=><button className="cc30-approval-item" type="button" key={m.id} onClick={()=>navigateTaso('Approvals')}><span>{m.objective}</span><small>İncele ↗</small></button>):<p className="cc30-muted">Bekleyen onay görünmüyor.</p>}</section>
     <section className="cc30-panel"><div className="cc30-panel-head"><div><span className="cc30-eyebrow">AJANLAR</span><h3>Çalışma durumu</h3></div><button type="button" onClick={()=>navigateTaso('AI Agents')}>Ajanlar ↗</button></div>{operations?.agents?.length?operations.agents.slice(0,5).map(a=><div className="cc30-agent" key={a.id}><span className={a.status==='busy'?'cc30-dot is-ready':'cc30-dot'}/><div><strong>{agentLabels[a.label]||a.label}</strong><small>{a.status==='busy'?'Çalışıyor':a.status==='ready'?'Hazır':a.status==='degraded'?'Kısıtlı':'Doğrulanamadı'}</small></div></div>):<p className="cc30-muted">Ajan verisi alınamadı.</p>}</section>
   </aside></div>
 </section>;
}
