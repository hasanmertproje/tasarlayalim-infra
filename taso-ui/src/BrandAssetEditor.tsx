import { useState } from 'react';

type Assets = { iconDataUrl?: string; lightIconDataUrl?: string; faviconDataUrl?: string };
export default function BrandAssetEditor({branding,onSaved}:{branding:Assets;onSaved:()=>void}) {
 const [draft,setDraft]=useState<Assets>({...branding});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function select(key:keyof Assets,file?:File){
  if(!file)return;
  setError('');setNotice('');
  if(!['image/gif','image/png','image/webp'].includes(file.type)||file.size>6*1024*1024){setError('PNG, WebP veya GIF seç. Dosya en fazla 6 MiB olabilir.');return;}
  try{const value=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Dosya okunamadı.'));reader.readAsDataURL(file)});setDraft(current=>({...current,[key]:value}));}catch(e){setError((e as Error).message)}
 }
 async function save(){setBusy(true);setError('');setNotice('');try{
  const response=await fetch('/api/control-plane/branding',{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(draft)});
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Görseller kaydedilemedi.');
  setNotice('Görseller kaydedildi.');window.dispatchEvent(new Event('taso:branding-changed'));onSaved();
 }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="brand-assets"><p>Animasyonlu GIF, PNG veya WebP yükle. Her dosya en fazla 6 MiB. Değişiklikleri aşağıdan kaydet.</p>{(['iconDataUrl','lightIconDataUrl','faviconDataUrl'] as const).map((key,index)=><div className="brand-asset-row" key={key}><img src={draft[key]||(key==='faviconDataUrl'?'/branding/taso-still.png':draft.iconDataUrl||'/branding/taso-default.gif')} alt="Görsel önizlemesi"/><label>{['Koyu tema ikonu','Açık tema ikonu','Tarayıcı ikonu'][index]}<input type="file" accept="image/gif,image/png,image/webp" disabled={busy} onChange={event=>{void select(key,event.target.files?.[0]);event.target.value=''}}/></label><button type="button" disabled={busy} onClick={()=>{setDraft(current=>({...current,[key]:''}));setNotice('Varsayılanı uygulamak için kaydet.')}}>Sıfırla</button></div>)}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}<button type="button" className="cp29-primary" disabled={busy} onClick={()=>void save()}>{busy?'Kaydediliyor…':'Görselleri kaydet'}</button></div>;
}
