import type { Mission, Project } from './domain.js';
import { assessVisualQaEvidence, type VisualQaReport } from './visual-qa.js';

export type MissionVisualVerification = {
  required:boolean;
  configured:boolean;
  passed:boolean;
  summary:string;
  blockerCount:number;
  warningCount:number;
  report?:VisualQaReport;
};

function workerUrl(){return (process.env.TASO_BROWSER_WORKER_URL||'').trim().replace(/\/$/,'')}
function workerSecret(){return (process.env.TASO_BROWSER_WORKER_SECRET||'').trim()}
export function missionNeedsVisualQa(mission:Mission){
  const mode=mission.execution?.intentProfile?.mode;
  const hints=new Set(mission.execution?.intentProfile?.skillHints??[]);
  return mode==='website'||mode==='fullstack'||hints.has('responsive-a11y')||hints.has('design-system')||hints.has('design-intelligence');
}
function concise(report:VisualQaReport){
  const sample=report.issues.slice(0,5).map(issue=>`${issue.viewport}/${issue.theme}: ${issue.message}`).join(' | ');
  return `${report.blockerCount} blocker, ${report.warningCount} warning${sample?` · ${sample}`:''}`.slice(0,1200);
}

export async function verifyMissionVisualPreview(project:Project,mission:Mission,previewUrl:string):Promise<MissionVisualVerification>{
  const required=missionNeedsVisualQa(mission);
  if(!required)return{required:false,configured:Boolean(workerUrl()&&workerSecret()),passed:true,summary:'Visual QA is not required for this mission type.',blockerCount:0,warningCount:0};
  const url=workerUrl(),secret=workerSecret();
  if(!url||!secret)return{required:true,configured:false,passed:false,summary:'Website/fullstack acceptance requires Browser Operator visual QA, but the browser worker is not configured.',blockerCount:1,warningCount:0};
  try{
    const response=await fetch(`${url}/run`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},body:JSON.stringify({url:previewUrl,viewports:['desktop','mobile'],themes:['dark','light'],actions:[]}),signal:AbortSignal.timeout(90_000)});
    const payload=await response.json().catch(()=>({error:`Browser worker HTTP ${response.status}`}));
    if(!response.ok)return{required:true,configured:true,passed:false,summary:`Browser worker failed: ${String((payload as any)?.error||response.status).slice(0,1000)}`,blockerCount:1,warningCount:0};
    const report=assessVisualQaEvidence(payload as any);
    const passed=report.status==='passed';
    return{required:true,configured:true,passed,summary:passed?`Visual QA passed on desktop/mobile and dark/light. ${report.warningCount} warning(s).`:`Visual QA failed: ${concise(report)}`,blockerCount:report.blockerCount,warningCount:report.warningCount,report};
  }catch(error){
    return{required:true,configured:true,passed:false,summary:`Browser visual verification failed: ${error instanceof Error?error.message:String(error)}`.slice(0,1200),blockerCount:1,warningCount:0};
  }
}
