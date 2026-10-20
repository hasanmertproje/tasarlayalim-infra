import type { StudioNode, StudioNodeStyle, StudioPage } from './studio-store.js';

/** Same bounded Studio grammar as the UI preview, serialized without script or raw HTML. */
function escapeHtml(s:string):string {
 return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
}
function inlineStyle(style:StudioNodeStyle):string {
 const props:Array<[keyof StudioNodeStyle,string,string]>=[
  ['color','color',''],['background','background',''],['fontSize','font-size','px'],
  ['padding','padding','px'],['borderRadius','border-radius','px'],
  ['textAlign','text-align',''],['fontWeight','font-weight',''],
 ];
 return props.flatMap(([key,name,unit])=>style[key]===undefined?[]:[name+':'+String(style[key])+unit]).join(';');
}
function nodeHtml(node:StudioNode):string {
 const tag=node.kind==='section'?'section':node.kind==='heading'?'h2':node.kind==='button'?'button':'p';
 const content=node.kind==='section'?node.children.map(nodeHtml).join(''):escapeHtml(node.text);
 return '<'+tag+' data-node-id="'+escapeHtml(node.id)+'"'+
  (inlineStyle(node.style)?' style="'+escapeHtml(inlineStyle(node.style))+'"':'')+
  (tag==='button'?' type="button"':'')+'>'+content+'</'+tag+'>';
}
export function studioPageHtml(page:StudioPage):string{
 return '<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>'+
  escapeHtml(page.name)+'</title>\n</head>\n<body>\n'+page.nodes.map(nodeHtml).join('\n')+'\n</body>\n</html>';
}
