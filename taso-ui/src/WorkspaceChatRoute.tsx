import { useEffect, useState } from 'react';
import DashboardChat from './DashboardChat';
import { navigateTaso } from './navigation';

type Project={id:string;name:string;repository?:string;lifecycleStatus?:string};
type Props={screen:'Work Together'|'Conversations'|'Voice'};

const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');
async function get<T>(path:string,signal:AbortSignal):Promise<T>{
 const response=await fetch(API+path,{credentials:'same-origin',cache:'no-store',signal,headers:{accept:'application/json'}});
 if(!response.ok)throw new Error(response.status===401?'Oturum sona erdi. Yeniden giriş yap.':path+' HTTP '+response.status);
 return response.json() as Promise<T>;
}

export default function WorkspaceChatRoute({screen}:Props){
 const [projects,setProjects]=useState<Project[]>([]);
 const [projectId,setProjectId]=useState('');
 const [searchReady,setSearchReady]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void Promise.all([
   get<{projects:Project[]}>('/v1/projects',controller.signal),
   get<{research?:{searchReady?:boolean}}>('/v1/research/status',controller.signal).catch(()=>undefined),
  ]).then(([payload,research])=>{
   if(controller.signal.aborted)return;
   const active=(payload.projects||[]).filter(project=>(project.lifecycleStatus||'active')==='active');
   setProjects(active);setProjectId(current=>active.some(project=>project.id===current)?current:active[0]?.id||'');
   setSearchReady(research?.research?.searchReady===true);setError('');
  }).catch(cause=>{if(!controller.signal.aborted)setError((cause as Error).message)})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[]);
 const together=screen==='Work Together';
 const voice=screen==='Voice';
 return <section className="tn-workspace-chat" aria-labelledby="tn-workspace-chat-title">
  <header className="tn-workspace-chat__header">
   <div><span className="tn-eyebrow">{voice?'TASO VOICE':together?'TASO İLE BİRLİKTE':'KONUŞMA GEÇMİŞİ'}</span>
    <h2 id="tn-workspace-chat-title">{voice?'Sesli ve yazılı TASO sohbeti':together?'Birlikte düşün, birlikte üret.':'Projeye bağlı konuşmalar'}</h2>
    <p>{voice?'Mikrofon izni ve tarayıcı desteği uygunsa gerçek TASO Core konuşmasında sesli etkileşimi kullan.':together?'Seçili proje bağlamında TASO ile gerçek Core sohbetini sürdür. Mesajlar proje konuşma kaydına yazılır.':'Önce projeni seç; TASO Core üzerinden kaydedilmiş konuşma geçmişin yüklensin.'}</p>
   </div>
   <button type="button" onClick={()=>navigateTaso('My Projects')}>Projelerim <span aria-hidden="true">↗</span></button>
  </header>
  {loading&&<div className="tn-workspace-chat__state" role="status">Projeler ve sohbet yetenekleri yükleniyor…</div>}
  {error&&<div className="tn-workspace-chat__error" role="alert"><strong>Sohbet bağlamı yüklenemedi.</strong><p>{error}</p><button type="button" onClick={()=>window.location.reload()}>Yeniden dene</button></div>}
  {!loading&&!error&&!projects.length&&<div className="tn-workspace-chat__empty"><h3>Henüz aktif proje yok</h3><p>Konuşma, TASO Core'da kayıtlı bir projeye bağlanır. Önce bir proje oluştur veya mevcut projeyi ekle.</p><button type="button" onClick={()=>navigateTaso('My Projects')}>Proje alanını aç</button></div>}
  {!loading&&!error&&projects.length>0&&<>
   <div className="tn-workspace-chat__context"><label htmlFor="tn-chat-project">Konuşma projesi</label><select id="tn-chat-project" value={projectId} onChange={event=>setProjectId(event.target.value)}>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select><span>{searchReady?'Web araması Core tarafından hazır olarak bildirildi':'Web araması hazır olduğu doğrulanmadı'}</span></div>
   <div className="tn-workspace-chat__conversation"><DashboardChat projectId={projectId} searchReady={searchReady}/></div>
  </>}
 </section>;
}
