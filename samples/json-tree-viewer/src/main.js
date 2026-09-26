import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
import { JSON_LIMITS, parseJsonTree, visibleNodes, nodeValue, restoreTreeState } from './json-tree.js';
const status=document.getElementById('status'),tree=document.getElementById('tree'),scroller=document.getElementById('scroller'),detail=document.getElementById('detail');
let client,model,expanded=new Set(),page=0,active=true,controller,loaded=false,stateRevision=0,settingRevision=0,themeRevision=-1,saving=false,dirty=false,timer;
const typeLabels={object:'对象',array:'数组',string:'字符串',number:'数字',boolean:'布尔',null:'空值'};
const themeDefaults = new WeakMap();
const themeProperties = [
  ['--background', 'surface.app'], ['--surface', 'surface.panel'],
  ['--foreground', 'text.primary'], ['--secondary', 'text.secondary'],
  ['--disabled', 'text.disabled'], ['--border', 'border.default'],
  ['--accent', 'accent.default'], ['--focus', 'focus.border'],
  ['--error', 'status.danger.text'], ['--button-background', 'fill.default'],
  ['--button-hover', 'fill.strong'], ['--button-active', 'fill.pressed'],
  ['--button-disabled', 'fill.subtle'], ['--hover', 'interaction.hover'],
  ['--active', 'interaction.active'], ['--selection', 'selection.background'],
  ['--selection-text', 'selection.text'], ['--scrollbar-thumb', 'scrollbar.thumb'],
  ['--scrollbar-track', 'scrollbar.track'],
];
function applyTheme(snapshot) {
  if (snapshot.revision <= themeRevision) return;
  document.documentElement.dataset.theme = snapshot.mode;
  // Only mutate this package's external stylesheet; no host styles or inline CSS.
  const sheet = [...document.styleSheets].find(item => item.href?.endsWith('/style.css'));
  const rules = sheet && [...sheet.cssRules].filter(item => [':root', ':root[data-theme="dark"]'].includes(item.selectorText));
  const rule = rules?.find(item => item.selectorText === (snapshot.mode === 'dark' ? ':root[data-theme="dark"]' : ':root'));
  if (!rule) return;
  // Reset both variants so partial snapshots never retain a previous host color.
  for (const themeRule of rules) {
    if (!themeDefaults.has(themeRule)) themeDefaults.set(themeRule, new Map(themeProperties.map(([property]) => [property, themeRule.style.getPropertyValue(property)])));
    for (const [property, fallback] of themeDefaults.get(themeRule)) {
      if (fallback) themeRule.style.setProperty(property, fallback);
      else themeRule.style.removeProperty(property);
    }
  }
  for (const [property, key] of themeProperties) {
    if (snapshot.colors[key]) rule.style.setProperty(property, snapshot.colors[key]);
  }
  themeRevision = snapshot.revision;
}
function showError(error){status.dataset.error='true';status.textContent=({FORBIDDEN:'当前文件读取未获授权或已撤权。',CONTENT_CHANGED:'文件已变化，请重新打开。',LIMIT:'读取或保存超过限制。',TIMEOUT:'读取超时，请重试。',UNAVAILABLE:'查看器或资源不可用，请重新打开。'})[error.code]??error.message;}
function showNode(node){const path=[];let cursor=node;while(cursor.parentId){path.unshift(String(cursor.key).replaceAll('~','~0').replaceAll('/','~1'));cursor=model.all[cursor.parentId-1];}detail.textContent='路径：'+(path.length?'/'+path.join('/'):'(根)')+'\n层级：'+node.depth+'\n'+(node.key===null?'根节点':typeof node.key==='number'?`索引 ${node.key}`:`键 ${JSON.stringify(node.key)}`)+'\n类型：'+typeLabels[node.type]+'\n'+nodeValue(node);}
function render(focusId){
  tree.replaceChildren();const rows=model?visibleNodes(model.root,expanded):[];page=Math.min(page,Math.max(0,Math.ceil(rows.length/JSON_LIMITS.pageRows)-1));
  for(const node of rows.slice(page*JSON_LIMITS.pageRows,(page+1)*JSON_LIMITS.pageRows)){
    const row=document.createElement('div');row.className='row';row.setAttribute('role','listitem');row.style.paddingLeft=Math.min(node.depth,12)*14+'px';
    if(node.children?.length){const toggle=document.createElement('button');toggle.className='toggle';toggle.dataset.toggle=String(node.id);toggle.setAttribute('aria-expanded',String(expanded.has(node.id)));toggle.setAttribute('aria-label',`${expanded.has(node.id)?'折叠':'展开'}节点 ${node.key??'根'}`);toggle.textContent=expanded.has(node.id)?'−':'+';toggle.onclick=()=>{if(expanded.has(node.id))expanded.delete(node.id);else if(expanded.size<JSON_LIMITS.expanded)expanded.add(node.id);else{showError(new Error('同时展开的节点超过 128 个限制'));return;}render(node.id);void saveState();};row.append(toggle);}else{const marker=document.createElement('span');marker.className='toggle';marker.textContent='·';row.append(marker);}
    const select=document.createElement('button');select.className='node';select.dataset.node=String(node.id);const key=node.key===null?'根':typeof node.key==='number'?`[${node.key}]`:JSON.stringify(node.key);const preview=nodeValue(node);select.textContent=key.slice(0,80)+(key.length>80?'…':'')+' : '+preview.slice(0,160)+(preview.length>160?'…（点击查看完整值）':'');select.onclick=()=>showNode(node);row.append(select);
    const type=document.createElement('span');type.className='type';type.textContent=typeLabels[node.type];row.append(type);tree.append(row);
  }
  document.getElementById('page').textContent=`${rows.length?page+1:0} / ${Math.ceil(rows.length/JSON_LIMITS.pageRows)} 页`;
  document.getElementById('previous').disabled=page===0;document.getElementById('next').disabled=(page+1)*JSON_LIMITS.pageRows>=rows.length;
  if(focusId)tree.querySelector(`[data-toggle="${focusId}"]`)?.focus();
}
async function saveState(){if(!model)return;dirty=true;if(saving)return;saving=true;try{while(dirty){dirty=false;const next=await client.setState({expanded:[...expanded].sort((a,b)=>a-b),page,scrollTop:scroller.scrollTop},stateRevision);stateRevision=next.revision;}}catch{const current=await client.getState().catch(()=>null);stateRevision=current?.revision??0;}finally{saving=false;}}
async function refresh(){
  controller?.abort();clearTimeout(timer);const current=new AbortController();controller=current;loaded=false;model=null;page=0;render();detail.textContent='点击节点查看完整值。';status.dataset.error='false';status.textContent='正在读取 JSON…';
  try{
    const context=await client.context();if(current.signal.aborted)return;applyTheme(context.theme);
    if(!context.resource||!context.readGranted){status.textContent='等待宿主授权当前资源';return;}
    if(context.resource.size>JSON_LIMITS.bytes)throw new Error('JSON 超过 1 MiB 文件上限');
    const decoder=new TextDecoder('utf-8',{fatal:true});let text='',offset=0;
    do{const chunk=await client.read(context.resource.handle,offset,LIMITS.readChunkBytes,{signal:current.signal});try{text+=decoder.decode(chunk.bytes,{stream:!chunk.eof});}catch{throw new Error('仅支持有效 UTF-8 编码的 JSON。');}if(!chunk.eof&&chunk.nextOffset<=offset)throw new Error('读取未取得进展');offset=chunk.nextOffset;if(chunk.eof)break;}while(offset<context.resource.size);
    if(current.signal.aborted)return;const parsed=parseJsonTree(text);const saved=await client.getState();if(current.signal.aborted)return;
    model=parsed;const all=visibleNodes(model.root,new Set(Array.from({length:model.count},(_,i)=>i+1)));model.all=all;const restored=restoreTreeState(saved?.schemaVersion===1?saved.value:null,all);expanded=restored.expanded;page=restored.page;stateRevision=saved?.revision??0;
    render();scroller.scrollTop=restored.scrollTop;document.getElementById('name').textContent=context.resource.name;status.textContent=`JSON：${model.count} 个节点 · 数字保留原文`;
    setTimeout(()=>{if(!current.signal.aborted)loaded=true;},0);
  }catch(error){if(!current.signal.aborted){model=null;render();showError(error);}}
}
scroller.addEventListener('scroll',()=>{clearTimeout(timer);if(loaded)timer=setTimeout(()=>void saveState(),200);});
for(const [id,delta] of [['previous',-1],['next',1]])document.getElementById(id).onclick=()=>{page+=delta;scroller.scrollTop=0;render();void saveState();};
document.getElementById('reload').onclick=()=>{if(active)void refresh();};
document.getElementById('collapse').onclick=()=>{if(!model)return;expanded=new Set([model.root.id]);page=0;render();void saveState();};
const types=document.getElementById('types');types.onchange=async()=>{try{const next=await client.setSetting('display',{showTypes:types.checked},settingRevision);settingRevision=next.revision;document.body.dataset.types=String(types.checked);}catch(error){showError(error);const current=await client.getSetting('display').catch(()=>undefined);if(current!==undefined){settingRevision=current?.revision??0;types.checked=current?.value?.showTypes!==false;}else types.checked=document.body.dataset.types!=='false';document.body.dataset.types=String(types.checked);}};
async function start(){try{client=createPluginClient();client.subscribe(event=>{if(event.type==='theme')applyTheme(event.theme);if(event.type==='activity'){active=event.active;if(active)void refresh();else{controller?.abort();void saveState();status.textContent='已暂停';}}});await client.ready();const display=await client.getSetting('display').catch(()=>{document.getElementById('notice').textContent='显示设置暂不可用，使用默认显示。';return null;});settingRevision=display?.revision??0;types.checked=display?.value?.showTypes!==false;document.body.dataset.types=String(types.checked);types.disabled=false;document.getElementById('reload').disabled=false;await refresh();}catch(error){showError(error);}}
void start();
