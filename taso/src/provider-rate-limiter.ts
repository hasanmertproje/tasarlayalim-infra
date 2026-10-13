/** Process-local provider-wide RPM/TPM reservations, not a distributed quota. */
export type ProviderRatePolicy={requests:number;tokens:number;windowMs:number};
type Window={requests:number;tokens:number;resetAt:number};
export class ProviderRateLimiter {
  private windows=new Map<string,Window>();
  constructor(private readonly policy:ProviderRatePolicy) {
    if(![policy.requests,policy.tokens,policy.windowMs].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Invalid rate policy');
  }
  admit(provider:string,estimatedTokens:number,now=Date.now()):{allowed:boolean;retryAfterMs:number} {
    if(!provider||!Number.isSafeInteger(estimatedTokens)||estimatedTokens<=0)return {allowed:false,retryAfterMs:0};
    let w=this.windows.get(provider);
    if(!w||now>=w.resetAt){
      w={requests:0,tokens:0,resetAt:now+this.policy.windowMs};
      this.windows.set(provider,w);
    }
    if(w.requests>=this.policy.requests||w.tokens+estimatedTokens>this.policy.tokens)
      return {allowed:false,retryAfterMs:Math.max(0,w.resetAt-now)};
    // Atomic within one JS event loop: no await between check and reservation.
    w.requests++;w.tokens+=estimatedTokens;
    return {allowed:true,retryAfterMs:0};
  }
  snapshot(provider:string){const w=this.windows.get(provider);return w?{...w}:undefined}
}
