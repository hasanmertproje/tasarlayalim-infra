import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import DashboardChat from './DashboardChat';
import {navigateTaso} from './navigation';
import {updateNode,type DesignDocument,type DesignNode} from './studio-document';
type Project={id:string;name:string;repository:string;lifecycleStatus?:string};
type Mission={id:string;projectId:string;objective:string;status:string;updatedAt?:string};
type Conversation={id:string;projectId:string;role:'user'|'assistant'|'system';content:string;replyMode?:'ai'|'unavailable'|'system'};
type Target={id:string;pageId:string;label:string;original:string};
const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');
async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const response=await fetch(API+path,{...init,credentials:'same-origin',cache:'no-store',
  headers:{accept:'application/json','content-type':'application/json',...(init.headers||{})}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error((body as {error?:string}).error||'Core HTTP '+response.status);
 return body as T;
}
function targets(doc:DesignDocument|null):Target[]{
 if(!doc)return[];
 const out:Target[]=[];
 const visit=(nodes:DesignNode[],pageId:string)=>{
  for(const node of nodes){
   if(node.kind==='heading'||node.kind==='text'||node.kind==='button')
    out.push({id:node.id,pageId,label:(node.text||node.kind).slice(0,54),original:node.text});
   visit(node.children,pageId);
  }
 };
 for(const page of doc.pages)visit(page.nodes,page.id);
 return out;
}
const done=new Set(['completed','failed','cancelled']);
export default function TasoTogether(){
 const [projects,setProjects]=useState<Project[]>([]),[projectId,setProjectId]=useState('');
 const [missions,setMissions]=useState<Mission[]>([]),[studioDoc,setDocument]=useState<DesignDocument|null>(null);
 const [lastAi,setLastAi]=useState<Conversation|null>(null),[hasSearch,setHasSearch]=useState(false);
 const [canWrite,setCanWrite]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [objective,setObjective]=useState(''),[risk,setRisk]=useState<'READ'|'WRITE'|'HIGH_IMPACT'>('WRITE');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[proposal,setProposal]=useState(false),[selectedNode,setSelectedNode]=useState('');
 const [candidate,setCandidate]=useState(''),[accepted,setAccepted]=useState(false),[refreshKey,setRefreshKey]=useState(0);
 const refresh=useCallback(()=>setRefreshKey(n=>n+1),[]);
 useEffect(()=>{const controller=new AbortController();let current=true;
   Promise.all([
    api<{projects:Project[]}>('/v1/projects'),api<{missions:Mission[]}>('/v1/missions'),
    fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():({permissions:[]})),
    api<{research:{searchReady?:boolean}}>('/v1/research/status').catch(()=>null),
   ]).then(([p,m,me,search])=>{if(!current)return;
    const available=(p.projects||[]).filter(v=>(v.lifecycleStatus||'active')==='active');
    setProjects(available);setMissions(m.missions||[]);
    setCanWrite(Boolean(Array.isArray(me.permissions)&&me.permissions.includes('projects.write')));
    setHasSearch(Boolean(search?.research?.searchReady));
    setProjectId(id=>available.some(p=>p.id===id)?id:available[0]?.id||'');setError('');
   }).catch(e=>{if(current)setError((e as Error).message)}).finally(()=>{if(current)setLoading(false)});
   return()=>{current=false;controller.abort()};
 },[refreshKey]);
 useEffect(()=>{
  let active=true;setDocument(null);setLastAi(null);setProposal(false);setAccepted(false);setSelectedNode('');
  if(!projectId)return;
  const load=async()=>{
   const [docResult,chatResult]=await Promise.allSettled([
    api<{document:DesignDocument|null}>('/v1/projects/'+encodeURIComponent(projectId)+'/studio'),
    api<{messages:Conversation[]}>('/v1/conversations?projectId='+encodeURIComponent(projectId)),
   ]);
   if(!active)return;
   if(docResult.status==='fulfilled')setDocument(docResult.value.document||null);
   else setError('Studio belgesi bu hesap veya proje için erişilebilir değil: '+docResult.reason.message);
   if(chatResult.status==='fulfilled'){
    setLastAi([...chatResult.value.messages].reverse().find(m=>m.role==='assistant'&&m.replyMode==='ai')||null);
   }else setLastAi(null);
  };
  void load();
  const timer=window.setInterval(()=>{if(!document.hidden)void load()},12000);
  return()=>{active=false;window.clearInterval(timer)};
 },[projectId,refreshKey]);
 const project=projects.find(p=>p.id===projectId);
 const relevant=missions.filter(m=>m.projectId===projectId).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 const active=relevant.filter(m=>!done.has(m.status));
 const options=useMemo(()=>targets(studioDoc),[document]);
 const target=options.find(o=>o.id===selectedNode);
 const suggestion=(lastAi?.content||'').trim().slice(0,1000);
 function chooseProject(id:string){setProjectId(id);setNotice('');setError('');setObjective('')}
 async function submitMission(e:FormEvent){
  e.preventDefault();if(!projectId||!objective.trim()||busy||!canWrite)return;
  setBusy(true);setError('');setNotice('');
  try{
   const created=await api<{mission:Mission}>('/v1/missions',{method:'POST',
    body:JSON.stringify({projectId,objective:objective.trim(),riskLevel:risk,dataClass:'private_code',
     autonomous:{enabled:true,previewRequired:true,production:'ask',destructive:'ask'}})});
   setNotice(created.mission.status==='waiting_approval'?'Görev Core üzerinde insan onayı bekliyor.':'Görev Core üzerinde oluşturuldu: '+created.mission.id);
   setObjective('');refresh();
  }catch(e){setError((e as Error).message)}
  finally{setBusy(false)}
 }
 async function approveProposal(){
  if(!studioDoc||!projectId||!canWrite||!target||!candidate.trim()||!accepted||busy)return;
  if(candidate.length>4000){setError('Öneri 4000 karakteri aşamaz.');return}
  setBusy(true);setError('');setNotice('');
  try{
   const pages=studioDoc.pages.map(p=>p.id===target.pageId?{...p,nodes:updateNode(p.nodes,target.id,node=>({...node,text:candidate}))}:p);
   // Never trust the browser approval alone: Core requires verified project write
   // permission, validates schema, and rejects stale expectedVersion.
   const changed=await api<{document:DesignDocument}>('/v1/projects/'+encodeURIComponent(projectId)+'/studio',{
    method:'PUT',body:JSON.stringify({expectedVersion:studioDoc.version,pages,title:studioDoc.title}),
   });
   setDocument(changed.document);
   setProposal(false);setAccepted(false);
   try{
    const checkpoint=await api<{document:DesignDocument}>('/v1/projects/'+encodeURIComponent(projectId)+'/studio/revisions',{
      method:'POST',body:JSON.stringify({expectedVersion:changed.document.version,label:'Beraber Yapalım: kullanıcı onaylı metin değişikliği'}),
    });
    setDocument(checkpoint.document);
    setNotice('Kullanıcının onayladığı öneri Core Studio belgesine kaydedildi ve revizyon oluşturuldu.');
   }catch(e){setError('Değişiklik Core belgesine kaydedildi ancak revizyon oluşturulamadı: '+(e as Error).message)}
  }catch(e){setError('Öneri uygulanamadı: '+(e as Error).message+'. Belge değişmişse Studio üzerinden yenile.')}
  finally{setBusy(false)}
 }
 return <section className="taso-together" aria-label="TASO ile Beraber Yapalım">
   <header className="together-header">
    <div><span className="together-kicker">TASO / BERABER YAPALIM</span><h1>Birlikte düşün. <em>Birlikte üret.</em></h1><p>Konuşmalar, gerçek görevler ve Studio değişiklikleri aynı proje bağlamında.</p></div>
    <button type="button" onClick={refresh} disabled={busy}>↻ Yenile</button>
   </header>
   <div className="together-context"><label>Çalışılan proje <select value={projectId} onChange={e=>chooseProject(e.target.value)} disabled={loading||busy}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><span title={project?.repository}>{project?.repository||'Proje seçilmedi'}</span><button type="button" onClick={()=>navigateTaso('Studio')} disabled={!projectId}>↗ Studio'yu aç</button></div>
   {error&&<p className="together-error" role="alert">{error}</p>}{notice&&<p className="together-success" role="status">{notice}</p>}
   <div className="together-layout">
    <aside className="together-sidebar">
     <section className="together-card"><span className="together-kicker">PROJE BAĞLAMI</span><h2>{project?.name||'Proje bekleniyor'}</h2><p>{project?.repository||'Core proje listesi yükleniyor'}</p>
      <div className="together-facts"><div><strong>{relevant.length}</strong><span>Toplam görev</span></div><div><strong>{active.length}</strong><span>Devam ediyor</span></div><div><strong>{studioDoc?.pages.length??'—'}</strong><span>Studio sayfası</span></div></div>
     </section>
     <section className="together-card"><span className="together-kicker">TASO'YU GÖREVLENDİR</span><h2>Gerçek iş başlat</h2><form onSubmit={submitMission}><label>Hedef<textarea value={objective} maxLength={16000} onChange={e=>setObjective(e.target.value)} placeholder="Örn. Projenin erişilebilirlik sorunlarını incele ve PR hazırla…" disabled={!canWrite||busy}/></label>
      <label>Risk seviyesi<select value={risk} onChange={e=>setRisk(e.target.value as typeof risk)}><option value="READ">Salt okuma</option><option value="WRITE">Kod değişikliği</option><option value="HIGH_IMPACT">Yüksek etki · onay gerekir</option></select></label>
      <button type="submit" disabled={!objective.trim()||!canWrite||busy||!projectId}>{busy?'İşleniyor…':'Core üzerinde görev oluştur ↗'}</button>
      <small>Görev, TASO'nun mevcut gerçek yürütme ve insan onayı politikalarına tabidir.</small>
     </form></section>
     <section className="together-card"><header><h2>Son görevler</h2><button type="button" onClick={()=>navigateTaso('Tasks')}>Tümünü aç ↗</button></header>
      {relevant.slice(0,5).map(m=><div className="together-task" key={m.id}><strong>{m.objective}</strong><small>{m.status}</small></div>)}
      {!relevant.length&&<p>Bu projede henüz kayıtlı görev yok.</p>}
     </section>
    </aside>
    <div className="together-main">
     <section className="together-card together-chat"><header><div><span className="together-kicker">PROJEYE BAĞLI SOHBET</span><h2>TASO ile konuş</h2></div><span>{project?'Core bağlantısı':'Proje seçilmeli'}</span></header>
      {projectId?<DashboardChat projectId={projectId} searchReady={hasSearch}/>:<p>Önce proje oluştur veya seç.</p>}
     </section>
     <section className="together-card together-proposal"><header><div><span className="together-kicker">STUDIO / ONAYLI DEĞİŞİKLİK</span><h2>AI yanıtından Studio önerisi</h2></div><button type="button" onClick={refresh}>Yanıtları yenile</button></header>
      {!lastAi?<p>Bu projede doğrulanmış bir AI yanıtı yok. Sohbet servisi yanıt üretmediyse Studio'da AI önerisi gösterilmez.</p>:
        <><p>Kaynak: Core sohbet geçmişindeki <code>{lastAi.id}</code> kimlikli gerçek AI yanıtı. Doğrudan belgeyi değiştirmez.</p>
          <div className="together-ai-excerpt">{suggestion}</div>
          {!proposal?<button type="button" disabled={!studioDoc||!canWrite||!options.length} onClick={()=>{setProposal(true);setCandidate(suggestion);setSelectedNode(options[0]?.id||'');setAccepted(false)}}>Bu yanıttan metin değişikliği öner</button>:
            <div className="together-diff">
             <label>Hedef Studio öğesi<select value={selectedNode} onChange={e=>{setSelectedNode(e.target.value);setAccepted(false)}}>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
             <div className="together-diff-columns"><div><b>Mevcut metin</b><p>{target?.original||'—'}</p></div><div><b>Önerilen metin</b><textarea maxLength={4000} rows={5} value={candidate} onChange={e=>{setCandidate(e.target.value);setAccepted(false)}}/></div></div>
             <label className="together-consent"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> Farkı inceledim; Core Studio'ya kaydedilmesini açıkça onaylıyorum.</label>
             <div className="together-decision"><button type="button" onClick={()=>{setProposal(false);setAccepted(false)}}>Reddet</button><button type="button" disabled={!accepted||!candidate.trim()||busy||!canWrite} onClick={()=>void approveProposal()}>Onayla ve Core'a uygula</button></div>
            </div>}
        </>}
      {!studioDoc&&<p>Studio belgesi yok veya yetki yetersiz. Önce Studio'da yetkili belge oluşturulmalı.</p>}
     </section>
    </div>
   </div>
 </section>;
}
