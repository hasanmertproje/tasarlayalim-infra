/** Pure, framework-free document operations; editor, HTML export and canvas share this grammar. */
export type NodeKind='section'|'heading'|'text'|'button';
export type NodeStyle={color?:string;background?:string;fontSize?:number;padding?:number;borderRadius?:number;textAlign?:'left'|'center'|'right';fontWeight?:number};
export type DesignNode={id:string;kind:NodeKind;text:string;style:NodeStyle;children:DesignNode[]};
export type DesignPage={id:string;name:string;slug:string;nodes:DesignNode[]};
export type SavedRevision={id:string;label:string;at:string;actorId:string;sourceVersion:number;pages:DesignPage[]};
export type DesignDocument={id:string;projectId:string;title:string;version:number;updatedAt:string;updatedBy:string;pages:DesignPage[];revisions:SavedRevision[]};
export const createNode=(kind:NodeKind):DesignNode=>({id:'node_'+crypto.randomUUID(),kind,text:kind==='heading'?'Başlığın buraya':kind==='text'?'Yeni metin alanı':kind==='button'?'Hemen başla':'',style:kind==='section'?{padding:24,background:'#151c40'}:kind==='heading'?{fontSize:32,color:'#ffffff',fontWeight:700}:{fontSize:16,color:'#e6e9fa'},children:[]});
export const createPage=(name:string):DesignPage=>({id:'page_'+crypto.randomUUID(),name,slug:name.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65)||'sayfa',nodes:[]});
export function locate(nodes:DesignNode[],target:string):DesignNode|undefined{for(const n of nodes){if(n.id===target)return n;const found=locate(n.children,target);if(found)return found}return undefined}
export function updateNode(nodes:DesignNode[],target:string,fn:(node:DesignNode)=>DesignNode):DesignNode[]{return nodes.map(n=>n.id===target?fn(n):({...n,children:updateNode(n.children,target,fn)}))}
export function removeNode(nodes:DesignNode[],target:string):DesignNode[]{return nodes.filter(n=>n.id!==target).map(n=>({...n,children:removeNode(n.children,target)}))}
export function shiftNode(nodes:DesignNode[],target:string,delta:-1|1):DesignNode[]{const index=nodes.findIndex(n=>n.id===target);if(index!==-1){const to=index+delta;if(to<0||to>=nodes.length)return nodes;const result=[...nodes];[result[index],result[to]]=[result[to],result[index]];return result}return nodes.map(n=>({...n,children:shiftNode(n.children,target,delta)}))}
export type StudioDropPlacement='before'|'after'|'inside';
/** Move one existing canonical document node; reject cycles, invalid nesting and missing targets. */
export function moveStudioNode(nodes:DesignNode[],sourceId:string,targetId:string,placement:StudioDropPlacement):DesignNode[]{
 if(sourceId===targetId)return nodes;
 const root=structuredClone(nodes);
 const locatePath=(items:DesignNode[],id:string,depth=0):{items:DesignNode[],index:number,depth:number}|undefined=>{
  for(let i=0;i<items.length;i++){
   if(items[i].id===id)return{items,index:i,depth};
   const found=locatePath(items[i].children,id,depth+1);
   if(found)return found;
  }
  return undefined;
 };
 const source=locatePath(root,sourceId);
 const dest=locatePath(root,targetId);
 if(!source||!dest)return nodes;
 const moved=source.items[source.index];
 const contains=(node:DesignNode,id:string):boolean=>node.id===id||node.children.some(c=>contains(c,id));
 if(contains(moved,targetId)||placement==='inside'&&dest.items[dest.index].kind!=='section')return nodes;
 const subtreeDepth=(node:DesignNode):number=>node.children.length?1+Math.max(...node.children.map(subtreeDepth)):0;
 const nextDepth=dest.depth+(placement==='inside'?1:0);
 if(nextDepth+subtreeDepth(moved)>4)return nodes;
 source.items.splice(source.index,1);
 const destination=locatePath(root,targetId);
 if(!destination)return nodes;
 if(placement==='inside'){
  // Dropping onto a section inserts at the beginning, matching the visible top-of-section drop target.
  destination.items[destination.index].children.unshift(moved);
 }else {
  destination.items.splice(destination.index+(placement==='after'?1:0),0,moved);
 }
 return root;
}
export function escapeHtml(s:string):string{return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))}
export function inlineStyle(s:NodeStyle):string{
 const properties:[keyof NodeStyle,string,string][]=[['color','color',''],['background','background',''],['fontSize','font-size','px'],['padding','padding','px'],['borderRadius','border-radius','px'],['textAlign','text-align',''],['fontWeight','font-weight','']];
 return properties.flatMap(([key,name,unit])=>s[key]===undefined?[]:[name+':'+String(s[key])+unit]).join(';');
}
export function nodeHtml(n:DesignNode):string{
 const tag=n.kind==='section'?'section':n.kind==='heading'?'h2':n.kind==='button'?'button':'p';
 const children=n.kind==='section'?n.children.map(nodeHtml).join(''):escapeHtml(n.text);
 return '<'+tag+' data-node-id="'+escapeHtml(n.id)+'"'+(inlineStyle(n.style)?' style="'+escapeHtml(inlineStyle(n.style))+'"':'')+(tag==='button'?' type="button"':'')+'>'+children+'</'+tag+'>';
}
export function pageHtml(p:DesignPage):string{
 const title=escapeHtml(p.name);
 return '<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>'+title+'</title>\n</head>\n<body>\n'+p.nodes.map(nodeHtml).join('\n')+'\n</body>\n</html>';
}
