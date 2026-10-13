export type CircuitState = 'closed' | 'open' | 'half-open';
export type CircuitSnapshot = { state:CircuitState; failures:number; retryAt:number; probeInFlight:boolean };
export class ProviderCircuitBreaker {
  private readonly states = new Map<string,CircuitSnapshot>();
  constructor(private readonly threshold=3, private readonly cooldownMs=30_000) {
    if (!Number.isInteger(threshold)||threshold<1||!Number.isFinite(cooldownMs)||cooldownMs<1) throw new Error('Invalid circuit configuration');
  }
  private state(id:string):CircuitSnapshot {
    let value=this.states.get(id);
    if(!value){value={state:'closed',failures:0,retryAt:0,probeInFlight:false};this.states.set(id,value)}
    return value;
  }
  snapshot(id:string):CircuitSnapshot{return {...this.state(id)}}
  acquire(id:string, now=Date.now()):boolean {
    const state=this.state(id);
    if(state.state==='open'){
      if(now<state.retryAt)return false;
      state.state='half-open';
    }
    if(state.state==='half-open'){
      if(state.probeInFlight)return false;
      state.probeInFlight=true;
    }
    return true;
  }
  complete(id:string, success:boolean, now=Date.now()):void {
    const state=this.state(id);
    // A stale completion must not close a newly opened circuit.
    if(state.state==='open')return;
    if(success){state.state='closed';state.failures=0;state.retryAt=0;state.probeInFlight=false;return}
    state.failures+=1;
    if(state.state==='half-open'||state.failures>=this.threshold){
      state.state='open';state.retryAt=now+this.cooldownMs;state.probeInFlight=false;
    }
  }
}
