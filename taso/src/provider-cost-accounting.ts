/** Monetary estimates are never invoices and require operator-supplied prices. */
export type TokenUsage={inputTokens:number;outputTokens:number};
export type TokenPrices={inputUsdPerMillion:number;outputUsdPerMillion:number;source:string};
export type CostEstimate={kind:'estimate';currency:'USD';amount:number;source:string};
export function estimateTokenCost(usage:TokenUsage,price?:TokenPrices):CostEstimate|undefined {
  if(!price||!price.source.trim())return undefined;
  const numbers=[usage.inputTokens,usage.outputTokens];
  if(!numbers.every(n=>Number.isSafeInteger(n)&&n>=0))return undefined;
  const rates=[price.inputUsdPerMillion,price.outputUsdPerMillion];
  if(!rates.every(n=>Number.isFinite(n)&&n>=0))return undefined;
  const amount=(usage.inputTokens*rates[0]!+usage.outputTokens*rates[1]!)/1_000_000;
  if(!Number.isFinite(amount))return undefined;
  return {kind:'estimate',currency:'USD',amount,source:price.source};
}
