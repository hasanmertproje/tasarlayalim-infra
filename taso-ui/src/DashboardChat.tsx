import { FormEvent, useEffect, useRef, useState } from 'react';
import { geminiTtsVoiceRuntime } from './GeminiTtsVoiceRuntime';
import SafeMarkdown, { safeExternalHref } from './SafeMarkdown';

type Message={id:string;role:string;content:string;replyMode?:'ai'|'system'|'unavailable';sources?:Array<{title:string;url:string}>};
type VoiceState='idle'|'listening'|'thinking'|'speaking'|'error'|'unsupported';
const API=((import.meta.env.VITE_TASO_API_URL as string|undefined)||'/api').replace(/\/$/,'');

function visibleMessages(payload:any):Message[]{return (payload?.messages||[]).filter((m:Message)=>m.role!=='system')}
function completedAssistant(messages:Message[],text:string){for(let i=messages.length-2;i>=0;i--){if(messages[i]?.role==='user'&&messages[i]?.content===text&&messages[i+1]?.role==='assistant')return messages[i+1]}return undefined}
function storedNumber(key:string,fallback:number){const parsed=Number(localStorage.getItem(key));return Number.isFinite(parsed)?parsed:fallback}

export default function DashboardChat({projectId,searchReady}:{projectId:string;searchReady:boolean}){
 const [messages,setMessages]=useState<Message[]>([]),[input,setInput]=useState(''),[web,setWeb]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [voiceSession,setVoiceSession]=useState(false),[voiceState,setVoiceState]=useState<VoiceState>('idle');
 const request=useRef<AbortController|null>(null),scroll=useRef<HTMLDivElement|null>(null),recognition=useRef<any>(null),restartTimer=useRef<number|undefined>(undefined);
 const busyRef=useRef(false),projectRef=useRef(projectId),voiceSessionRef=useRef(false),webRef=useRef(web),startingVoice=useRef(false);
 useEffect(()=>{busyRef.current=busy},[busy]);
 useEffect(()=>{projectRef.current=projectId},[projectId]);
 useEffect(()=>{voiceSessionRef.current=voiceSession},[voiceSession]);
 useEffect(()=>{webRef.current=web},[web]);

 async function readHistory(signal?:AbortSignal){const response=await fetch(`${API}/v1/conversations?projectId=${encodeURIComponent(projectRef.current)}`,{credentials:'same-origin',cache:'no-store',signal,headers:{accept:'application/json'}});if(!response.ok)throw new Error(response.status===401?'Oturum sona erdi. Yeniden giriş yap.':'Sohbet geçmişi yüklenemedi.');return visibleMessages(await response.json())}
 function stopVoiceSession(){voiceSessionRef.current=false;startingVoice.current=false;setVoiceSession(false);if(restartTimer.current)window.clearTimeout(restartTimer.current);restartTimer.current=undefined;recognition.current?.stop?.();recognition.current=null;geminiTtsVoiceRuntime.cancel();if('speechSynthesis' in window)window.speechSynthesis.cancel();setVoiceState('idle')}
 useEffect(()=>{request.current?.abort();busyRef.current=false;stopVoiceSession();const controller=new AbortController();request.current=controller;setMessages([]);setError('');setBusy(false);setInput('');if(!projectId)return;setLoading(true);
  void readHistory(controller.signal).then(history=>{if(!controller.signal.aborted)setMessages(history)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[projectId]);
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[messages,busy]);
 useEffect(()=>()=>{voiceSessionRef.current=false;if(restartTimer.current)window.clearTimeout(restartTimer.current);recognition.current?.stop?.();geminiTtsVoiceRuntime.cancel();if('speechSynthesis' in window)window.speechSynthesis.cancel()},[]);

 async function recoverCompletedTurn(text:string,signal:AbortSignal):Promise<Message|undefined>{for(const delay of [250,750,1500]){await new Promise(resolve=>window.setTimeout(resolve,delay));if(signal.aborted)return undefined;try{const history=await readHistory(signal);const assistant=completedAssistant(history,text);if(assistant){setMessages(history);setInput('');setError('');return assistant}}catch{}}return undefined}
 function scheduleListening(delay=300){if(restartTimer.current)window.clearTimeout(restartTimer.current);restartTimer.current=window.setTimeout(()=>{if(voiceSessionRef.current&&!busyRef.current&&projectRef.current&&!geminiTtsVoiceRuntime.isSpeaking())beginRecognition()},delay)}
 async function speakCoreReply(text:string){
  if(!voiceSessionRef.current||!text.trim()||localStorage.getItem('taso-voice-replies')==='false'){if(voiceSessionRef.current){setVoiceState('idle');scheduleListening()}return}
  const response=await geminiTtsVoiceRuntime.speak(text,{
   projectId:projectRef.current,volume:storedNumber('taso-gemini-tts-volume',1),
   onState:state=>{if(!voiceSessionRef.current)return;if(state==='speaking')setVoiceState('speaking');else if(state==='starting')setVoiceState('thinking');else if(state==='error')setVoiceState('error');else setVoiceState('idle')}
  });
  if(!voiceSessionRef.current)return;
  if(!response.started){
   if(response.error==='cancelled')return;
   if('speechSynthesis' in window&&'SpeechSynthesisUtterance' in window){
    try{
     setVoiceState('speaking');
     await new Promise<void>(resolve=>{
      const utterance=new SpeechSynthesisUtterance(text);
      utterance.lang='tr-TR';utterance.rate=1;utterance.volume=Math.max(0,Math.min(1,storedNumber('taso-gemini-tts-volume',1)));
      const turkish=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('tr'));
      if(turkish)utterance.voice=turkish;
      let settled=false;const done=()=>{if(settled)return;settled=true;window.clearTimeout(timeout);resolve()};
      utterance.onend=done;utterance.onerror=done;
      const timeout=window.setTimeout(()=>{window.speechSynthesis.cancel();done()},Math.min(45000,Math.max(8000,text.length*100)));
      window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);
     });
    }catch(e){setError(`Tarayıcı sesli yanıt hatası: ${(e as Error).message}`);setVoiceState('error')}
   }else{setError('Sesli yanıt servisi kullanılamıyor ve bu tarayıcı ses sentezini desteklemiyor.');setVoiceState('error')}
  }
  if(voiceSessionRef.current){setVoiceState('idle');scheduleListening(350)}
 }

 async function sendText(text:string,fromVoice=false){const normalized=text.trim();if(busyRef.current||loading||!projectRef.current||!normalized)return;const controller=new AbortController();request.current?.abort();request.current=controller;busyRef.current=true;setBusy(true);setError('');if(fromVoice)setVoiceState('thinking');
  const timer=window.setTimeout(()=>{controller.abort();busyRef.current=false;setBusy(false);setError('Yanıt zaman aşımına uğradı. Mesajın kaydedilip kaydedilmediğini görmek için sayfayı yenile.');if(fromVoice&&voiceSessionRef.current){setVoiceState('error');scheduleListening(700)}},100_000);
  try{const response=await fetch(`${API}/v1/conversations/messages`,{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({projectId:projectRef.current,text:normalized,webSearch:webRef.current})});const payload=await response.json().catch(()=>({}));if(!controller.signal.aborted&&payload.userMessage&&payload.assistantMessage){setMessages(current=>[...current,payload.userMessage,payload.assistantMessage]);setInput('');window.clearTimeout(timer);if(fromVoice)await speakCoreReply(payload.assistantMessage.content??'')}if(!response.ok)throw new Error(response.status===401?'Oturum sona erdi. Yeniden giriş yap.':payload.error||'Yanıt alınamadı.')}
  catch(e){if(!controller.signal.aborted){const assistant=await recoverCompletedTurn(normalized,controller.signal);if(assistant){if(fromVoice)await speakCoreReply(assistant.content)}else if(!controller.signal.aborted){setError((e as Error).message==='Failed to fetch'?'Yanıt sunucuda tamamlanmış olabilir ancak bağlantı koptu. Tekrar deneyebilirsin.':(e as Error).message);if(fromVoice&&voiceSessionRef.current){setVoiceState('error');scheduleListening(700)}}}}
  finally{window.clearTimeout(timer);if(!controller.signal.aborted){busyRef.current=false;setBusy(false);if(fromVoice&&voiceSessionRef.current)setVoiceState(current=>current==='speaking'||current==='error'?current:'idle')}}
 }
 async function send(event:FormEvent){event.preventDefault();const text=input.trim();if(!text)return;await sendText(text,false)}

 function beginRecognition(){if(busyRef.current||!projectRef.current||recognition.current||geminiTtsVoiceRuntime.isSpeaking())return;const Recognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!Recognition){voiceSessionRef.current=false;setVoiceSession(false);setVoiceState('unsupported');setError('Bu tarayıcı sesli girişi desteklemiyor. Android Chrome veya uyumlu bir tarayıcı kullan.');return}
  let finalSubmitted=false;const instance=new Recognition();instance.lang='tr-TR';instance.continuous=false;instance.interimResults=true;instance.maxAlternatives=1;instance.onstart=()=>setVoiceState('listening');instance.onresult=(event:any)=>{let interim='';let finalText='';for(let index=event.resultIndex;index<event.results.length;index+=1){const part=event.results[index][0]?.transcript??'';if(event.results[index].isFinal)finalText+=part;else interim+=part}const finalValue=finalText.trim();setInput((finalValue||interim).trim());if(finalValue&&!finalSubmitted){finalSubmitted=true;instance.stop();setInput('');void sendText(finalValue,true)}};
  instance.onerror=(event:any)=>{const code=event.error??'unknown';if(code==='not-allowed'||code==='service-not-allowed'){stopVoiceSession();setVoiceState('error');setError('Mikrofon izni verilmedi. Sesli konuşma için mikrofon izni gerekli.');return}if(code!=='aborted'&&code!=='no-speech')setError(`Sesli giriş hatası: ${code}`);if(code!=='aborted')setVoiceState(code==='no-speech'?'idle':'error')};
  instance.onend=()=>{if(recognition.current===instance)recognition.current=null;if(!finalSubmitted&&voiceSessionRef.current&&!busyRef.current){setVoiceState('idle');scheduleListening(300)}};recognition.current=instance;try{instance.start()}catch(e){recognition.current=null;stopVoiceSession();setVoiceState('error');setError(`Mikrofon başlatılamadı: ${(e as Error).message}`)}
 }
 async function toggleVoiceSession(){
  if(voiceSessionRef.current){stopVoiceSession();return}
  if(startingVoice.current||busyRef.current||loading||!projectRef.current)return;
  if(!(window as any).SpeechRecognition&&!(window as any).webkitSpeechRecognition){setVoiceState('unsupported');setError('Bu tarayıcı konuşma tanımayı desteklemiyor. Uyumlu bir tarayıcıda tekrar dene.');return}
  if(!window.isSecureContext){setVoiceState('error');setError('Mikrofon için HTTPS güvenli bağlantı gerekir.');return}
  startingVoice.current=true;
  setError('');voiceSessionRef.current=true;setVoiceSession(true);setVoiceState('idle');
  // Recognition.start runs within the user's click activation, not behind a delayed timer.
  beginRecognition();
  startingVoice.current=false;
  void geminiTtsVoiceRuntime.unlock();
 }
 const voiceLabel=voiceState==='listening'?'Dinliyor':voiceState==='thinking'?'Düşünüyor':voiceState==='speaking'?'Konuşuyor':voiceState==='error'?'Ses hatası':voiceState==='unsupported'?'Desteklenmiyor':'Hazır';

 return <section className={`dashboard-chat voice-${voiceState} ${voiceSession?'voice-session':''}`} aria-label="Taso ile sohbet" data-voice-policy="core-conversation"><header><div><span>TASO İLE KONUŞ</span><h2>Aklındaki soruyla başla.</h2></div><span className="chat-web-status">{searchReady?'Web araması bağlı':'Web araması bağlı değil'}</span></header><div className="dashboard-chat-messages" ref={scroll} aria-live="polite" aria-busy={busy||loading}>{loading?<p>Sohbet yükleniyor…</p>:messages.length?messages.map(message=><article key={message.id} className={message.role==='user'?'from-user':'from-taso'}><span>{message.role==='user'?'SEN':message.replyMode==='unavailable'?'TASO · HİZMET HATASI':'TASO'}</span><SafeMarkdown text={message.content}/>{Boolean(message.sources?.length)&&<nav className="chat-sources" aria-label="Araştırma kaynakları">{message.sources!.filter(source=>Boolean(safeExternalHref(source.url))).map((source,index)=><a key={`${source.url}-${index}`} href={safeExternalHref(source.url)} target="_blank" rel="noopener noreferrer">{index+1}. {source.title} ↗</a>)}</nav>}</article>):<p className="chat-empty">Bir soru sor, bir bağlantı gönder veya bir fikri değerlendir.</p>}{busy&&<p role="status">{web?'Web kaynakları araştırılıyor, yanıt hazırlanıyor…':'Taso düşünüyor…'}</p>}</div>{error&&<p className="cc29-error" role="alert">{error}</p>}<form onSubmit={send}><label className="sr-only" htmlFor="dashboard-question">Taso’ya sor</label><div className="dashboard-chat-input-row"><button type="button" className={voiceSession?'dashboard-chat-mic is-active':'dashboard-chat-mic'} onClick={()=>void toggleVoiceSession()} aria-label={voiceSession?'Canlı sesli sohbeti kapat':'Taso ile sesli konuş'} aria-pressed={voiceSession}>{voiceSession?'■':'🎙'}</button><textarea id="dashboard-question" placeholder="Taso’ya sor…" rows={2} maxLength={16000} value={input} disabled={busy} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}/></div><div className="chat-actions"><label><input type="checkbox" checked={web} onChange={e=>setWeb(e.target.checked)}/> Web’de ara</label><span className="dashboard-chat-voice-state" aria-live="polite">{voiceSession?`Ses · ${voiceLabel}`:'Ses · Kapalı'}</span><button disabled={busy||loading||!projectId||!input.trim()}>{busy?'Yanıt bekleniyor…':'Gönder ↗'}</button></div></form>{!projectId&&<p>Konuşmak için önce bir proje ekle veya seç.</p>}</section>;
}
