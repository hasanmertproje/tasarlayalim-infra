import https from 'node:https';
const paths=['/','/api/auth/session','/api/health','/api/gateway/health'];
const host='taso.tasarlayalim.com';
for(const path of paths){
 const result=await new Promise(resolve=>{
  const req=https.request({hostname:host,servername:host,path,method:'GET',timeout:12000,lookup:(_name,opts,cb)=>cb(null,opts.all?[{address:'45.74.243.96',family:4}]:'45.74.243.96',opts.all?undefined:4),rejectUnauthorized:true,headers:{Accept:'application/json'}},res=>{
   let body='';res.on('data',chunk=>{if(body.length<10000)body+=chunk});res.on('end',()=>{
    let obj={};try{obj=JSON.parse(body)}catch{}
    resolve({status:res.statusCode,type:String(res.headers['content-type']||'').split(';')[0],configured:typeof obj.configured==='boolean'?obj.configured:null,authenticated:typeof obj.authenticated==='boolean'?obj.authenticated:null})
   })
  });req.on('error',e=>resolve({network:e.code||'FAILED'}));req.on('timeout',()=>req.destroy());req.end();
 });
 console.log(path,JSON.stringify(result))
}
