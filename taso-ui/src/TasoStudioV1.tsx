import {useEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {navigateTaso} from './navigation';
import NextOrb from './NextOrb';
import {createNode,createPage,locate,nodeHtml,pageHtml,removeNode,shiftNode,moveStudioNode,updateNode,type NodeKind,type DesignDocument,type DesignNode,type DesignPage,type NodeStyle,type StudioDropPlacement,type StudioLibraryEntry,instantiateLibraryNode} from './studio-document';
const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');
type Project={id:string;name:string;repository:string;lifecycleStatus?:string};
type Mode='mobile'|'tablet'|'desktop';
type Panel='layers'|'properties';
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
 const response=await fetch(API+path,{...init,credentials:'same-origin',cache:'no-store',headers:{accept:'application/json','content-type':'application/json',...(init.headers||{})}});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error((payload as {error?:string}).error||'Studio API '+response.status);
 return payload as T;
}
function clone<T>(v:T):T{return structuredClone(v)}
const kindLabel:Record<NodeKind,string>={section:'Bölüm',heading:'Başlık',text:'Metin',button:'Buton'};
function NodeView({node,selectedId,onSelect}:{node:DesignNode;selectedId:string;onSelect:(id:string)=>void}){
 const tag=node.kind==='heading'?'h2':node.kind==='text'?'p':'div';
 const css:CSSProperties={...node.style,whiteSpace:'pre-wrap',overflowWrap:'anywhere'};
 return <div className={'studio-node studio-node--'+node.kind+(selectedId===node.id?' is-selected':'')} data-node-id={node.id} onClick={event=>{event.stopPropagation();onSelect(node.id)}} role="button" tabIndex={0} aria-label={kindLabel[node.kind]+': '+(node.text||'Boş')}
   onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(node.id)}}} style={css}>
    {node.kind==='section'?node.children.length?node.children.map(child=><NodeView key={child.id} node={child} selectedId={selectedId} onSelect={onSelect}/>):<span className="studio-node__empty">Bölüm boş — katmandan içerik ekle</span>:
     node.kind==='button'?<span className="studio-node__button">{node.text}</span>:
     tag==='h2'?<h2>{node.text}</h2>:<p>{node.text}</p>}
 </div>;
}
function Tree({nodes,selected,onPick,onMove,canWrite,dragSource,level=0}:{nodes:DesignNode[];selected:string;onPick:(id:string)=>void;onMove:(source:string,target:string,placement:StudioDropPlacement)=>void;canWrite:boolean;dragSource:{current:string|null};level?:number}):ReactNode{
 return nodes.map(node=><div key={node.id} className="studio-tree-branch">
  <div className="studio-tree-row" data-studio-drop-id={node.id}
    onDragOver={e=>{if(canWrite)e.preventDefault()}}
    onDrop={e=>{e.preventDefault();const src=e.dataTransfer.getData('application/x-taso-node')||dragSource.current;dragSource.current=null;if(src&&canWrite)onMove(src,node.id,node.kind==='section'?'inside':'before')}}>
    <button type="button" style={{paddingLeft:12+level*16}} className={'studio-tree-item'+(selected===node.id?' is-selected':'')} onClick={()=>onPick(node.id)} aria-current={selected===node.id?'true':undefined}>
      <span aria-hidden="true">{node.kind==='section'?'▦':node.kind==='heading'?'T':node.kind==='button'?'◇':'≡'}</span><span>{node.kind==='section'?'Bölüm':node.text.slice(0,32)||kindLabel[node.kind]}</span>
    </button>
    <button type="button" className="studio-tree-handle" disabled={!canWrite} draggable={canWrite}
      title="Sürükle veya dokunarak yeniden sırala"
      aria-label={kindLabel[node.kind]+' katmanını taşı'}
      onDragStart={e=>{dragSource.current=node.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-taso-node',node.id);e.dataTransfer.setData('text/plain',node.id)}} onDragEnd={()=>{dragSource.current=null}}
      onPointerDown={e=>{if(e.pointerType==='touch'){e.currentTarget.setPointerCapture(e.pointerId)}}}
      onPointerUp={e=>{
        if(e.pointerType!=='touch'||!canWrite)return;
        const under=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-studio-drop-id]');
        const target=under?.dataset.studioDropId;
        if(target&&target!==node.id){const destKind=locate(nodes,target)?.kind;onMove(node.id,target,destKind==='section'?'inside':'before')}
      }}>↕</button>
  </div>
  {node.children.length?<Tree nodes={node.children} selected={selected} onPick={onPick} onMove={onMove} canWrite={canWrite} dragSource={dragSource} level={level+1}/>:null}
 </div>);
}
export default function TasoStudioV1(){
 const dragSource=useRef<string|null>(null);
 const [projects,setProjects]=useState<Project[]>([]),[projectId,setProjectId]=useState('');
 const [serverDoc,setServerDoc]=useState<DesignDocument|null>(null),[draft,setDraft]=useState<DesignDocument|null>(null);
 const [past,setPast]=useState<DesignDocument[]>([]),[future,setFuture]=useState<DesignDocument[]>([]);
 const [pageId,setPageId]=useState(''),[selectedId,setSelectedId]=useState('');
 const [viewport,setViewport]=useState<Mode>('desktop'),[panel,setPanel]=useState<Panel>('layers'),[panelOpen,setPanelOpen]=useState(false);
 const [showCode,setShowCode]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [canRead,setCanRead]=useState(false),[canWrite,setCanWrite]=useState(false),[revisionName,setRevisionName]=useState('');
 const dirty=Boolean(draft&&serverDoc&&JSON.stringify({pages:draft.pages,title:draft.title,library:draft.library||[]})!==JSON.stringify({pages:serverDoc.pages,title:serverDoc.title,library:serverDoc.library||[]}));
 const page=draft?.pages.find(p=>p.id===pageId)||draft?.pages[0];
 const selected=page?locate(page.nodes,selectedId):undefined;
 const revisions=draft?.revisions??[];
 const available=projects.filter(p=>(p.lifecycleStatus||'active')==='active');
 const apiPath=projectId?'/v1/projects/'+encodeURIComponent(projectId)+'/studio':'';
 const markup=useMemo(()=>page?pageHtml(page):'', [page]);
 const selectProject=(id:string)=>{if(dirty&&!window.confirm('Kaydedilmemiş Studio değişiklikleri silinsin mi?'))return;setProjectId(id);setServerDoc(null);setDraft(null);setPast([]);setFuture([]);setPageId('');setSelectedId('')};
 useEffect(()=>{let active=true;const load=async()=>{try{
  const [p,me]=await Promise.all([request<{projects:Project[]}>('/v1/projects'),fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():({permissions:[]}))]);
  if(!active)return;
  setProjects(p.projects||[]);const perms=Array.isArray(me.permissions)?me.permissions:[];
  setCanRead(perms.includes('projects.read'));setCanWrite(perms.includes('projects.write'));
  setProjectId(prev=>prev||p.projects?.find(x=>x.id===sessionStorage.getItem('taso-studio-project')&&(x.lifecycleStatus||'active')==='active')?.id||p.projects?.find(x=>(x.lifecycleStatus||'active')==='active')?.id||'');
 }catch(e){if(active)setError((e as Error).message)}finally{if(active)setLoading(false)}};void load();return()=>{active=false}},[]);
 useEffect(()=>{if(!projectId||!canRead)return;let active=true;setLoading(true);setError('');void request<{document:DesignDocument|null}>('/v1/projects/'+encodeURIComponent(projectId)+'/studio').then(x=>{if(!active)return;setServerDoc(x.document);setDraft(x.document?clone(x.document):null);setPageId(x.document?.pages[0]?.id||'');setSelectedId('');setPast([]);setFuture([])}).catch(e=>{if(active)setError((e as Error).message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[projectId,canRead]);
 function apply(change:(current:DesignDocument)=>DesignDocument){
  if(!draft||!canWrite||busy)return;const next=change(clone(draft));setPast(stack=>[...stack.slice(-39),clone(draft)]);setFuture([]);setDraft(next);setNotice('');
 }
 function pageChange(change:(p:DesignPage)=>DesignPage){
  if(!page)return;apply(d=>({...d,pages:d.pages.map(p=>p.id===page.id?change(p):p)}));
 }
 function addNode(kind:NodeKind){
  if(!page||!canWrite)return;
  const node=createNode(kind);
  const target=selected?.kind==='section'?selected.id:undefined;
  pageChange(p=>({...p,nodes:target?updateNode(p.nodes,target,n=>({...n,children:[...n.children,node]})):[...p.nodes,node]}));
  setSelectedId(node.id);setPanel('properties');
 }
 function moveNode(delta:-1|1){if(!page||!selected)return;pageChange(p=>({...p,nodes:shiftNode(p.nodes,selected.id,delta)}))}
 function moveTo(source:string,target:string,placement:StudioDropPlacement){
  if(!page||!canWrite||busy)return;
  const result=moveStudioNode(page.nodes,source,target,placement);
  if(result===page.nodes){setError('Bu katman hedef konuma taşınamıyor.');return}
  pageChange(p=>({...p,nodes:moveStudioNode(p.nodes,source,target,placement)}));
  setSelectedId(source);setError('');
 }
 function editNode(update:(n:DesignNode)=>DesignNode){if(!page||!selected)return;pageChange(p=>({...p,nodes:updateNode(p.nodes,selected.id,update)}))}
 function addPage(){
  const name=window.prompt('Yeni sayfanın adı','Yeni Sayfa')?.trim();if(!name)return;
  const p=createPage(name);if(!draft||draft.pages.some(v=>v.slug===p.slug)){setError('Sayfa adı farklı olmalı.');return}
  apply(d=>({...d,pages:[...d.pages,p]}));setPageId(p.id);setSelectedId('');setError('');
 }
 function saveComponent(){
  if(!draft||!selected||!canWrite||busy)return;
  if((draft.library||[]).length>=24){setError('Bu projede en fazla 24 bileşen saklanabilir.');return}
  const name=window.prompt('Bileşen kitaplığına kaydet','Yeni '+kindLabel[selected.kind])?.trim();
  if(!name)return;
  if(name.length>80){setError('Bileşen adı en fazla 80 karakter olabilir.');return}
  const entry:StudioLibraryEntry={id:'lib_'+crypto.randomUUID(),name,node:clone(selected)};
  apply(doc=>({...doc,library:[...(doc.library||[]),entry]}));
  setNotice('Bileşen taslağa eklendi. Kalıcı olması için Değişiklikleri kaydet.');
 }
 function insertComponent(entry:StudioLibraryEntry){
  if(!page||!canWrite||busy)return;
  const component=instantiateLibraryNode(entry.node);
  const parent=selected?.kind==='section'?selected.id:undefined;
  pageChange(p=>({...p,nodes:parent?updateNode(p.nodes,parent,n=>({...n,children:[...n.children,component]})):[...p.nodes,component]}));
  setSelectedId(component.id);setPanel('properties');
 }
 function deleteComponent(id:string){
  if(!draft||!canWrite||busy||!window.confirm('Bileşen kütüphanesinden kaldırılsın mı? Mevcut sayfa öğeleri korunur.'))return;
  apply(doc=>({...doc,library:(doc.library||[]).filter(item=>item.id!==id)}));
 }
 function deletePage(){if(!draft||!page||draft.pages.length<2)return;if(!window.confirm('Bu sayfa silinsin mi?'))return;const other=draft.pages.find(x=>x.id!==page.id);apply(d=>({...d,pages:d.pages.filter(x=>x.id!==page.id)}));setPageId(other?.id||'');setSelectedId('')}
 async function init(){
  if(!apiPath||busy)return;setBusy(true);setError('');
  try{const result=await request<{document:DesignDocument}>(apiPath,{method:'POST',body:JSON.stringify({title:'Yeni Tasarım'})});setServerDoc(result.document);setDraft(clone(result.document));setPageId(result.document.pages[0]?.id||'');setNotice('Studio belgesi Core veritabanında oluşturuldu.')}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function persist(doc:DesignDocument):Promise<DesignDocument>{
  const response=await request<{document:DesignDocument}>(apiPath,{method:'PUT',body:JSON.stringify({expectedVersion:serverDoc?.version,title:doc.title,pages:doc.pages,library:doc.library||[]})});
  setServerDoc(response.document);setDraft(clone(response.document));setPast([]);setFuture([]);return response.document;
 }
 async function save(checkpoint=false){
  if(!draft||!canWrite||busy)return;setBusy(true);setError('');
  try{
   const current=dirty?await persist(draft):serverDoc||draft;
   if(checkpoint){
    const label=revisionName.trim()||'Kaydedilen sürüm';
    const response=await request<{document:DesignDocument}>(apiPath+'/revisions',{method:'POST',body:JSON.stringify({expectedVersion:current.version,label})});
    setServerDoc(response.document);setDraft(clone(response.document));setRevisionName('');setNotice('Sürüm Core üzerinde kaydedildi.');
   }else setNotice('Değişiklikler Core üzerinde kaydedildi.');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function downloadHtml(){
  if(!page||!draft||busy||!canRead)return;
  if(dirty){setError('HTML çıktısı için önce değişiklikleri Core üzerinde kaydet.');return}
  setBusy(true);setError('');
  try{
   const url=apiPath+'/pages/'+encodeURIComponent(page.id)+'/export.html?version='+encodeURIComponent(String(serverDoc?.version));
   const response=await fetch(API+url,{credentials:'same-origin',cache:'no-store',headers:{accept:'text/html'}});
   if(!response.ok)throw new Error('HTML dışa aktarma izni veya kaynak sürümü doğrulanamadı (HTTP '+response.status+').');
   if(!(response.headers.get('content-type')||'').includes('text/html'))throw new Error('Core HTML beklenmeyen içerik döndürdü.');
   if(response.headers.get('x-taso-studio-version')!==String(serverDoc?.version))throw new Error('HTML çıktısı kaydedilen Studio sürümüyle eşleşmiyor. Yeniden yükleyin.');
   const blob=await response.blob();const objectUrl=URL.createObjectURL(blob);
   const link=document.createElement('a');link.href=objectUrl;link.download='taso-'+page.slug+'.html';
   document.body.append(link);link.click();link.remove();
   window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
   setNotice('Kaydedilmiş Studio sayfası Core üzerinden HTML olarak indirildi. Bu bir yayınlama işlemi değildir.');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function restore(id:string){
  if(!draft||!canWrite||busy)return;
  if(!window.confirm('Bu sürüme geri dönülsün mü? Kaydedilmemiş değişiklikler kaybolur.'))return;
  setBusy(true);setError('');
  try{
   const response=await request<{document:DesignDocument}>(apiPath+'/revisions/'+encodeURIComponent(id)+'/restore',{method:'POST',body:JSON.stringify({expectedVersion:serverDoc?.version})});
   setServerDoc(response.document);setDraft(clone(response.document));setPast([]);setFuture([]);setPageId(current=>response.document.pages.some(page=>page.id===current)?current:response.document.pages[0]?.id||'');setSelectedId('');setNotice('Önceki sürüm sunucudan geri yüklendi.');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 function undo(){
  if(!past.length||busy)return;const previous=past[past.length-1];if(!previous||!draft)return;setFuture(v=>[clone(draft),...v].slice(0,40));setPast(v=>v.slice(0,-1));setDraft(previous);setSelectedId('');
 }
 function redo(){
  if(!future.length||busy)return;const next=future[0];if(!next||!draft)return;setPast(v=>[...v,clone(draft)].slice(-40));setFuture(v=>v.slice(1));setDraft(next);setSelectedId('');
 }
 function updateStyle(key:keyof NodeStyle,value:string){
  editNode(n=>({...n,style:{...n.style,[key]:['fontSize','padding','borderRadius','fontWeight'].includes(key)?Number(value):value}}));
 }
 const propertyPanel=<>
  <div className="studio-panel__title"><b>Özellikler</b><small>{selected?kindLabel[selected.kind]:'Öğe seçin'}</small></div>
  {selected?<div className="studio-fields">
    {selected.kind!=='section'&&<label>Metin<textarea rows={3} maxLength={4000} value={selected.text} disabled={!canWrite} onChange={e=>editNode(n=>({...n,text:e.target.value}))}/></label>}
    <label>Metin rengi<input type="color" value={selected.style.color||'#ffffff'} disabled={!canWrite} onChange={e=>updateStyle('color',e.target.value)}/></label>
    <label>Arkaplan<input type="color" value={selected.style.background||'#151c40'} disabled={!canWrite} onChange={e=>updateStyle('background',e.target.value)}/></label>
    <label>Yazı boyutu <output>{selected.style.fontSize||16}px</output><input type="range" min="10" max="96" value={selected.style.fontSize||16} disabled={!canWrite} onChange={e=>updateStyle('fontSize',e.target.value)}/></label>
    <label>İç boşluk <output>{selected.style.padding||0}px</output><input type="range" min="0" max="100" value={selected.style.padding||0} disabled={!canWrite} onChange={e=>updateStyle('padding',e.target.value)}/></label>
    <label>Köşe yarıçapı <output>{selected.style.borderRadius||0}px</output><input type="range" min="0" max="100" value={selected.style.borderRadius||0} disabled={!canWrite} onChange={e=>updateStyle('borderRadius',e.target.value)}/></label>
    <label>Hizalama<select value={selected.style.textAlign||'left'} disabled={!canWrite} onChange={e=>updateStyle('textAlign',e.target.value)}><option value="left">Sol</option><option value="center">Orta</option><option value="right">Sağ</option></select></label>
    <label>Yazı kalınlığı<select value={selected.style.fontWeight||400} disabled={!canWrite} onChange={e=>updateStyle('fontWeight',e.target.value)}><option value={400}>Normal</option><option value={500}>Orta</option><option value={700}>Kalın</option><option value={900}>Çok kalın</option></select></label>
    <div className="studio-library-save"><button type="button" disabled={!canWrite||busy||(draft?.library||[]).length>=24} onClick={saveComponent}>＋ Seçili bileşeni kitaplığa kaydet</button></div>
    <div className="studio-fields__actions"><button disabled={!canWrite} type="button" onClick={()=>moveNode(-1)}>↑ Yukarı</button><button disabled={!canWrite} type="button" onClick={()=>moveNode(1)}>↓ Aşağı</button><button disabled={!canWrite} type="button" className="danger" onClick={()=>{pageChange(p=>({...p,nodes:removeNode(p.nodes,selected.id)}));setSelectedId('')}}>Öğeyi sil</button></div>
  </div>:<p className="studio-hint">Tuvalden veya katman ağacından bir öğe seçerek metnini ve stilini düzenleyin.</p>}
  <div className="studio-copilot"><b>✦ TASO AI Copilot</b><p>Model tabanlı kod/değişiklik önerisi henüz etkin değil. Değişiklikleri AI üretmiş gibi göstermiyoruz. İleride öneri → diff → onay → uygulama akışıyla bağlanacak.</p></div>
 </>;
 const layerPanel=<><div className="studio-panel__title"><b>Katmanlar</b><small>{page?.nodes.length??0} kök öğe</small></div>
  <div className="studio-layer-list">{page?.nodes.length?<Tree nodes={page.nodes} selected={selectedId} onPick={setSelectedId} onMove={moveTo} canWrite={canWrite} dragSource={dragSource}/>:<p className="studio-hint">Bu sayfa henüz boş. Yukarıdaki araçlardan bir bileşen ekleyin.</p>}</div>
  <div className="studio-insert-list">{(['section','heading','text','button'] as NodeKind[]).map(kind=><button type="button" key={kind} disabled={!draft||!canWrite} onClick={()=>addNode(kind)}>＋ {kindLabel[kind]}</button>)}</div>
  <section className="studio-library" aria-label="Proje bileşen kütüphanesi">
   <div className="studio-panel__title"><b>Proje bileşenleri</b><small>{(draft?.library||[]).length}/24</small></div>
   {(draft?.library||[]).length===0?<p className="studio-hint">Bir öğe seçip özellikler panelinden kitaplığa kaydet. Yeniden kullanılabilir öğeler Core belgesinde saklanır.</p>:
   <div className="studio-library__list">{(draft?.library||[]).map(entry=><div key={entry.id}>
    <button type="button" disabled={!canWrite||busy} onClick={()=>insertComponent(entry)} title={entry.name+' bileşenini sayfaya ekle'}>＋ {entry.name}</button>
    <button type="button" className="studio-library__remove" disabled={!canWrite||busy} aria-label={entry.name+' bileşenini sil'} onClick={()=>deleteComponent(entry.id)}>×</button>
   </div>)}</div>}
  </section>
 </>;
 return <section className="taso-studio" aria-label="TASO Studio">
   <header className="studio-topbar"><div className="studio-brand"><NextOrb size="small"/><div><span>TASO / CREATIVE ENGINE</span><h1>Tasarım Stüdyosu</h1></div></div>
    <div className="studio-topbar__actions"><button type="button" onClick={()=>navigateTaso('Projects')}>← Projeler</button><button type="button" disabled={!projectId} onClick={()=>{sessionStorage.setItem('taso-focus-project',projectId);navigateTaso('CoWork')}}>Proje hakkında konuş ↗</button><button type="button" onClick={undo} disabled={!past.length||busy}>↶ Geri al</button><button type="button" onClick={redo} disabled={!future.length||busy}>↷ Yinele</button><button type="button" onClick={()=>void downloadHtml()} disabled={!draft||!page||busy||!canRead} title={dirty?'Kaydedilmemiş değişiklikleri önce Core\'a kaydet':'Kalıcı Core belge sürümünden HTML indir'}>⇩ HTML indir</button><button className="studio-primary" type="button" onClick={()=>void save()} disabled={!draft||!dirty||busy||!canWrite}>{busy?'Kaydediliyor…':dirty?'Değişiklikleri kaydet':'Kaydedildi'}</button></div>
   </header>
   {error&&<div className="studio-alert" role="alert">{error} <button onClick={()=>setError('')} type="button">×</button></div>}{notice&&<p className="studio-notice" role="status">{notice}</p>}
   <div className="studio-context"><label>Proje <select value={projectId} disabled={loading||busy} onChange={e=>selectProject(e.target.value)}>{available.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><span>{draft?'Belge sürümü '+draft.version:loading?'Yükleniyor…':'Henüz Studio belgesi yok'}</span><span>{dirty?'● Kaydedilmemiş değişiklikler':'✓ Sunucuyla eşit'}</span></div>
   {!loading&&!canRead?<div className="studio-blocked">Bu hesap için proje görüntüleme yetkisi yok. Studio erişimi sunucu tarafından korunuyor.</div>:null}
   {!loading&&canRead&&!draft?<div className="studio-empty"><NextOrb size="large"/><h2>Projene bağlı tasarım alanı</h2><p>Oluşturduğun sayfa ve bileşenler TASO Core'un kalıcı proje kaydına yazılır. Her adım gerçek sunucu üzerinde saklanır.</p><button type="button" disabled={!canWrite||!projectId||busy} onClick={()=>void init()}>＋ Studio belgesi oluştur</button></div>:null}
   {draft&&<div className="studio-layout">
     <aside className={'studio-left'+(panelOpen&&panel==='layers'?' is-open':'')} aria-label="Sayfa ve katmanlar">
       <div className="studio-panel__title"><b>Sayfalar</b><button type="button" disabled={!canWrite||draft.pages.length>=24} onClick={addPage}>＋ Ekle</button></div>
       <div className="studio-page-list">{draft.pages.map(p=><button type="button" key={p.id} className={page?.id===p.id?'active':''} onClick={()=>{setPageId(p.id);setSelectedId('')}}><span>▤</span>{p.name}</button>)}</div>
       <button type="button" className="studio-delete-page" disabled={!canWrite||draft.pages.length<2} onClick={deletePage}>Sayfayı sil</button>
       {layerPanel}
     </aside>
     <main className="studio-center">
       <div className="studio-tools"><div className="studio-tools__insert">{(['section','heading','text','button'] as NodeKind[]).map(kind=><button type="button" key={kind} onClick={()=>addNode(kind)} disabled={!canWrite} title={kindLabel[kind]}>＋ {kindLabel[kind]}</button>)}</div><div className="studio-tools__view" role="group" aria-label="Artboard boyutu">{(['desktop','tablet','mobile'] as Mode[]).map(mode=><button type="button" aria-pressed={viewport===mode} className={viewport===mode?'active':''} key={mode} onClick={()=>setViewport(mode)}>{mode==='desktop'?'Masaüstü':mode==='tablet'?'Tablet':'Mobil'}</button>)}</div><button type="button" className="studio-code-toggle" aria-pressed={showCode} onClick={()=>setShowCode(x=>!x)}>{showCode?'Tuval':'Kod'} görünümü</button></div>
       <div className="studio-board" data-viewport={viewport}><div className={'studio-artboard studio-artboard--'+viewport}><div className="studio-artboard__title"><span>{page?.name||'Sayfa'}</span><span>{viewport==='desktop'?'1440 × 900':viewport==='tablet'?'768 × 1024':'390 × 844'}</span></div>
         {showCode?<pre className="studio-source" aria-label="Deterministik HTML kaynağı"><code>{markup}</code></pre>:<div className="studio-canvas" aria-label="Sayfa tuvali" onClick={()=>setSelectedId('')}>
           {page?.nodes.map(n=><NodeView key={n.id} node={n} selectedId={selectedId} onSelect={setSelectedId}/>)}
           {!page?.nodes.length&&<div className="studio-canvas__empty">Tuval boş. Bölüm, başlık, metin veya buton ekleyerek başlayın.</div>}
         </div>}</div></div>
       <section className="studio-history"><div><b>Sürüm geçmişi</b><small>Sunucuya kaydedilmiş geri dönüş noktaları</small></div>
        <div className="studio-history__save"><input aria-label="Sürüm adı" maxLength={120} placeholder="Örn. Mobil hero düzeni" value={revisionName} onChange={e=>setRevisionName(e.target.value)}/><button type="button" onClick={()=>void save(true)} disabled={!canWrite||busy}>Sürüm kaydet</button></div>
        <div className="studio-revisions">{revisions.map(r=><div key={r.id}><span><strong>{r.label}</strong><small>{new Date(r.at).toLocaleString('tr-TR')} · v{r.sourceVersion}</small></span><button type="button" disabled={!canWrite||busy} onClick={()=>void restore(r.id)}>Geri yükle</button></div>)}{revisions.length===0&&<p className="studio-hint">Henüz kayıtlı sürüm yok.</p>}</div>
       </section>
     </main>
     <aside className={'studio-right'+(panelOpen&&panel==='properties'?' is-open':'')} aria-label="Seçili bileşen özellikleri">{propertyPanel}</aside>
     <nav className="studio-mobile-tabs" aria-label="Mobil editör araçları"><button type="button" onClick={()=>{setPanel('layers');setPanelOpen(v=>panel==='layers'?!v:true)}} aria-expanded={panelOpen&&panel==='layers'}>☷ Sayfalar & Katmanlar</button><button type="button" onClick={()=>{setPanel('properties');setPanelOpen(v=>panel==='properties'?!v:true)}} aria-expanded={panelOpen&&panel==='properties'}>⚙ Özellikler</button><button type="button" onClick={()=>setPanelOpen(false)}>Tuval</button></nav>
     {panelOpen&&<button type="button" className="studio-sheet-backdrop" aria-label="Düzenleme panelini kapat" onClick={()=>setPanelOpen(false)}/>}
   </div>}
 </section>;
}
