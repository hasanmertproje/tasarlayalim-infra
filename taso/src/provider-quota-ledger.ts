/**
 * In-process admission and usage ledger. Reservations are synchronous to prevent
 * same-process concurrency oversubscription; distributed deployments need a
 * shared transactional store before treating these limits as global.
 */
export type AiUsageKey = { provider:string; model:string; userId:string; projectId:string; missionId:string };
export type AiQuota = { requestsPerWindow:number; tokensPerWindow:number; windowMs:number };
export type AiUsage = { requests:number; reservedTokens:number; consumedTokens:number; resetAt:number };
type Entry = AiUsage;
const keyOf=(key:AiUsageKey)=>JSON.stringify([key.provider,key.model,key.userId,key.projectId,key.missionId]);
function validQuota(q:AiQuota){
  return Number.isSafeInteger(q.requestsPerWindow)&&q.requestsPerWindow>0
    &&Number.isSafeInteger(q.tokensPerWindow)&&q.tokensPerWindow>0
    &&Number.isSafeInteger(q.windowMs)&&q.windowMs>0;
}
export class ProviderQuotaLedger {
  private readonly entries=new Map<string,Entry>();
  private sequence=0;
  private readonly reservations=new Map<number,{key:string;tokens:number}>();
  constructor(private readonly quota:AiQuota) {
    if(!validQuota(quota)) throw new Error('Invalid AI quota');
  }
  reserve(identity:AiUsageKey, estimatedTokens:number, now=Date.now()):number|undefined {
    if(!Number.isSafeInteger(estimatedTokens)||estimatedTokens<=0) return undefined;
    if(!Object.values(identity).every(v=>typeof v==='string'&&v.length>0)) return undefined;
    const key=keyOf(identity);
    let entry=this.entries.get(key);
    if(!entry || now>=entry.resetAt){
      // In-flight reservations must not silently disappear at window rollover.
      if(entry && entry.reservedTokens>0)return undefined;
      entry={requests:0,reservedTokens:0,consumedTokens:0,resetAt:now+this.quota.windowMs};
      this.entries.set(key,entry);
    }
    if(entry.requests>=this.quota.requestsPerWindow)return undefined;
    if(entry.reservedTokens+entry.consumedTokens+estimatedTokens>this.quota.tokensPerWindow)return undefined;
    entry.requests++;
    entry.reservedTokens+=estimatedTokens;
    const id=++this.sequence;
    this.reservations.set(id,{key,tokens:estimatedTokens});
    return id;
  }
  /** Missing upstream token usage retains the full reserved amount as consumed. */
  settle(reservationId:number, usedTokens?:number):void {
    const reservation=this.reservations.get(reservationId);
    if(!reservation)throw new Error('Invalid reservation');
    const entry=this.entries.get(reservation.key);
    if(!entry)throw new Error('Missing quota state');
    this.reservations.delete(reservationId);
    entry.reservedTokens-=reservation.tokens;
    const measured=Number.isSafeInteger(usedTokens)&&usedTokens!>=0 ? usedTokens! : reservation.tokens;
    entry.consumedTokens+=Math.max(reservation.tokens,measured);
  }
  snapshot(identity:AiUsageKey):AiUsage|undefined {
    const entry=this.entries.get(keyOf(identity));
    return entry?{...entry}:undefined;
  }
}
