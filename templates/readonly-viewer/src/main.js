import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
const content=document.getElementById('content'),status=document.getElementById('status');
let client,controller,active=true,loaded=false,revision=0,themeRevision=-1,timer,saving=false;
function theme(snapshot){if(snapshot.revision<=themeRevision)return;themeRevision=snapshot.revision;document.documentElement.style.setProperty('--background',snapshot.colors['surface.app']??'#ffffff');document.documentElement.style.setProperty('--foreground',snapshot.colors['text.primary']??'#222222');}
async function checkpoint(){if(!loaded||saving)return;saving=true;try{const saved=await client.setState({scrollTop:content.scrollTop},revision);revision=saved.revision;}catch{revision=(await client.getState().catch(()=>null))?.revision??0;}finally{saving=false;}}
async function refresh(){controller?.abort();clearTimeout(timer);controller=new AbortController();const current=controller;loaded=false;content.textContent='';status.textContent='正在读取…';try{
 const context=await client.context();if(current.signal.aborted)return;theme(context.theme);if(!context.resource||!context.readGranted){status.textContent='等待宿主授权当前文件';return;}if(context.resource.size>262144)throw new Error('模板只读取 256 KiB 以内的 UTF-8 文本');
 const decoder=new TextDecoder('utf-8',{fatal:true});let offset=0,text='';do{const part=await client.read(context.resource.handle,offset,LIMITS.readChunkBytes,{signal:current.signal});if(!part.eof&&part.nextOffset<=offset)throw new Error('读取未取得进展');text+=decoder.decode(part.bytes,{stream:!part.eof});offset=part.nextOffset;if(part.eof)break;}while(offset<context.resource.size);
 const saved=await client.getState();if(current.signal.aborted)return;revision=saved?.revision??0;content.textContent=text;content.scrollTop=Number.isFinite(saved?.value?.scrollTop)?Math.max(0,saved.value.scrollTop):0;document.getElementById('name').textContent=context.resource.name;status.textContent='只读文本';setTimeout(()=>{if(!current.signal.aborted)loaded=true;},0);
 }catch(error){if(!current.signal.aborted)status.textContent=error instanceof TypeError?'文件不是有效 UTF-8 文本。':error.message;}}
content.addEventListener('scroll',()=>{clearTimeout(timer);if(loaded)timer=setTimeout(()=>void checkpoint(),200);});
document.getElementById('reload').onclick=()=>{if(active)void refresh();};
async function start(){try{client=createPluginClient();client.subscribe(event=>{if(event.type==='theme')theme(event.theme);if(event.type==='activity'){active=event.active;if(active)void refresh();else{controller?.abort();void checkpoint();status.textContent='已暂停';}}});await client.ready();document.getElementById('reload').disabled=false;await refresh();}catch{status.textContent='请通过 OmniFlow 插件管理安装并打开此查看器。';}}
void start();
