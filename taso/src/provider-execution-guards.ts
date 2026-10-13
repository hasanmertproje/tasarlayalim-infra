/** Shared request executor: bounded attempts, cancellable backoff and sanitized errors.
 * Provider routing and cost authorization must happen before invoking this helper. */
export type ProviderAttemptResult<T> = { value:T; status?:never } | { status:number; retryAfter?:string|null; value?:never };
export type ExecutionOptions = { maxAttempts?:number; baseDelayMs?:number; maxDelayMs?:number; timeoutMs?:number; signal?:AbortSignal };
export class ProviderExecutionError extends Error {
  constructor(public readonly category:'permanent'|'exhausted'|'aborted', public readonly status?:number) {
    super(`Provider request ${category}${status ? ` (HTTP ${status})` : ''}`);
    this.name='ProviderExecutionError';
  }
}
function retryable(status:number){return [408,409,425,429].includes(status)||(status>=500&&status<=599)}
function after(header:string|null|undefined,now:number):number{
  if(!header)return 0;
  const h=header.trim();
  if(/^\d+$/.test(h))return Math.min(120000,Number(h)*1000);
  const parsed=Date.parse(h);
  return Number.isFinite(parsed)?Math.min(120000,Math.max(0,parsed-now)):0;
}
function finiteInt(n:number|undefined,defaultValue:number,max:number){
  return n===undefined?defaultValue:Number.isSafeInteger(n)?Math.max(1,Math.min(n,max)):defaultValue;
}
function wait(ms:number,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)return Promise.reject(new ProviderExecutionError('aborted'));
  return new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel)};
    const cancel=()=>{done();reject(new ProviderExecutionError('aborted'))};
    const timer=setTimeout(()=>{done();resolve()},ms);
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
  });
}
export async function executeProviderRequest<T>(
  action:(signal:AbortSignal,attempt:number)=>Promise<ProviderAttemptResult<T>>,
  opts:ExecutionOptions={},
):Promise<T>{
  const maxAttempts=finiteInt(opts.maxAttempts,2,5);
  const base=finiteInt(opts.baseDelayMs,500,10000);
  const cap=finiteInt(opts.maxDelayMs,10000,120000);
  const timeout=finiteInt(opts.timeoutMs,60000,120000);
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    if(opts.signal?.aborted)throw new ProviderExecutionError('aborted');
    const timer=AbortSignal.timeout(timeout);
    const signal=opts.signal?AbortSignal.any([opts.signal,timer]):timer;
    let status:number|undefined;
    let retryAfter:string|null|undefined;
    try{
      const result=await action(signal,attempt);
      if('status' in result && typeof result.status==='number'){
        status=result.status;retryAfter=result.retryAfter;
        if(!retryable(status))throw new ProviderExecutionError('permanent',status);
      }else return result.value as T;
    }catch(e){
      if(opts.signal?.aborted)throw new ProviderExecutionError('aborted');
      if(e instanceof ProviderExecutionError)throw e;
      if(signal.aborted){status=undefined}
      else { // Unknown transport errors are transient, never expose upstream details.
        status=undefined;
      }
    }
    if(attempt===maxAttempts)throw new ProviderExecutionError('exhausted',status);
    const delay=Math.min(120000,Math.max(Math.min(cap,base*2**(attempt-1)),status===429||status===503?after(retryAfter,Date.now()):0));
    await wait(delay,opts.signal);
  }
  throw new ProviderExecutionError('exhausted');
}
