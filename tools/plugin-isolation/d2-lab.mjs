import { app, BrowserWindow, webContents } from 'electron';
import { registerPluginScheme } from '../../electron/service/extensions/isolated-view.ts';
import { registerFirstPartyViewer } from '../../electron/service/extensions/first-party-viewer.ts';
import { PluginManager } from '../../electron/service/extensions/plugin-manager.ts';
import { registerPluginManagementIpc } from '../../electron/service/extensions/plugin-management-ipc.ts';
import { createServer } from 'node:http';
import { writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const work=process.env.OMNIFLOW_LAB_WORK,external=JSON.parse(process.env.OMNIFLOW_LAB_D2);
app.setPath('userData',path.join(work,'profile'));registerPluginScheme();app.on('window-all-closed',()=>undefined);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const start=Date.now();while(!await check()){if(Date.now()-start>10000)throw new Error('Condition timeout');await delay(30);}}
const checks=[];function pass(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name);}
void(async()=>{let parent,server,manager;let completed=false;
 try{
 await app.whenReady();let origin;
 let jsonVersion='v1',jsonBytes=Buffer.from('{"title":"合成 JSON","large":9007199254740993,"extreme":1e400,"html":"<img src=x onerror=alert(1)>","group":{"items":'+JSON.stringify(Array.from({length:250},(_,i)=>({n:i,tag:'value'})))+'},"__proto__":{"safe":true}}');
 const csvBytes=Buffer.from('a,b\n1,2'),textBytes=Buffer.from('<b>模板纯文本</b>');
 const resource=id=>id===99?{bytes:jsonBytes,ext:'json',version:jsonVersion}:id===100?{bytes:csvBytes,ext:'csv',version:'v1'}:{bytes:textBytes,ext:'txt',version:'v1'};
 server=createServer((req,res)=>{
  if(req.url.startsWith('/api/')){
   if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(403);res.end();return;}
   let data;
   if(req.url==='/api/v1/user/me')data={id:42};
   else if(/^\/api\/v1\/nodes\/(99|100|101)$/.test(req.url)){const id=Number(req.url.split('/').at(-1)),r=resource(id);data={id,libraryId:3,type:'file',name:'synthetic',ext:r.ext,fileSize:r.bytes.length,storageKey:id+'.'+r.ext,storageBucket:'bucket',updatedAt:r.version};}
   else if(req.url.startsWith('/api/v1/directory/link?')){const id=Number(new URL(req.url,origin).searchParams.get('nodeId'));data=origin+'/bucket/'+id+'.'+resource(id).ext;}
   else {res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'0',data}));return;
  }
  const found=/^\/bucket\/(99|100|101)\.(json|csv|txt)$/.exec(req.url),range=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range??'');if(!found||!range){res.writeHead(404);res.end();return;}const r=resource(Number(found[1])),a=Number(range[1]),b=Number(range[2]);res.writeHead(206,{ETag:'"'+r.version+'"','Content-Range':`bytes ${a}-${b}/${r.bytes.length}`});res.end(r.bytes.subarray(a,b+1));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 parent=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(work,'host-preload.cjs')}});await parent.loadURL('data:text/html,<h1>Trusted D2 host</h1>');
 manager=new PluginManager(path.join(work,'plugins'),process.env.OMNIFLOW_LAB_SAMPLE);await manager.initialize();registerPluginManagementIpc(manager,()=>parent);registerFirstPartyViewer(()=>parent,{manager,apiBaseUrl:origin+'/api',storageOrigins:[origin],preloadPath:path.join(work,'preload.cjs')});
 const control=(method,...args)=>parent.webContents.executeJavaScript(`electronPluginManagement.${method}(...${JSON.stringify(args)})`);
 const viewer=(method,...args)=>parent.webContents.executeJavaScript(`electronPluginViewer.${method}(...${JSON.stringify(args)})`);
 await parent.webContents.executeJavaScript('window.snapshots=[];electronPluginViewer.subscribe(event=>{if(event.type==="state")snapshots.push(event.snapshot)});true');
 const input={clientId:'json-v1',viewerId:'example.json-tree.tree',nodeId:99,libraryId:3,token:'synthetic',username:'test',snapshot:null,theme:{schemaVersion:1,revision:1,mode:'light',colors:{'surface.app':'#ffffff','text.primary':'#222222'}}};
 const current=()=>webContents.getAllWebContents().find(item=>item.getURL().startsWith('omniflow-extension:'));
 const install=async file=>{const review=await manager.prepare(file);await control('commit',review.ticket);return review;};
 const enable=async id=>{await control('action',id,'enable');await control('action',id,'approve-read');};
 pass('kit-and-projects-built-outside-host',external.independent&&external.offline&&!external.generatedProject.startsWith(process.cwd()+path.sep));
 await install(external.generatedZip);await enable('external.notes');pass('generated-starter-opens-with-existing-host',(await viewer('open',{...input,clientId:'starter',viewerId:'external.notes.main',nodeId:101})).ok);let plugin=current();await until(async()=>await plugin.executeJavaScript('document.getElementById("content").textContent.includes("模板纯文本")'));pass('starter-renders-text-not-html',await plugin.executeJavaScript('!document.querySelector("pre b")'));await viewer('close','starter');
 await install(external.jsonV1);pass('JSON-install-does-not-grant',(await control('catalog')).plugins.some(item=>item.id==='example.json-tree'&&!item.enabled&&!item.readApproved));await enable('example.json-tree');pass('JSON-opens-with-generic-existing-bridge',(await viewer('open',input)).ok);await viewer('layout','json-v1',{x:10,y:60,width:960,height:600});plugin=current();await until(async()=>await plugin.executeJavaScript('document.getElementById("status").textContent.includes("个节点")'));
 pass('numbers-remain-exact',await plugin.executeJavaScript('document.getElementById("tree").textContent.includes("9007199254740993")&&document.getElementById("tree").textContent.includes("1e400")'));
 pass('JSON-values-do-not-execute',await plugin.executeJavaScript('document.images.length===0&&({}).safe===undefined'));
 await plugin.executeJavaScript(`document.querySelector('[aria-label="展开节点 group"]').click();true`);await plugin.executeJavaScript(`document.querySelector('[aria-label="展开节点 items"]').click();true`);
 pass('tree-renders-a-bounded-page',await plugin.executeJavaScript('document.querySelectorAll("#tree .row").length===200'));
 await plugin.executeJavaScript('document.getElementById("next").click();true');await until(async()=>await parent.webContents.executeJavaScript('snapshots.some(s=>s.state.value.page===1&&s.state.value.expanded.length===3)'));
 const checkpoint=await parent.webContents.executeJavaScript('snapshots.at(-1)');await viewer('close','json-v1');await viewer('open',{...input,clientId:'json-restored',snapshot:checkpoint});plugin=current();await until(async()=>await plugin.executeJavaScript('document.getElementById("page").textContent.includes("2 / 2")'));pass('JSON-tree-checkpoint-restored',true);
 await viewer('theme','json-restored',{...input.theme,revision:2,mode:'dark',colors:{'surface.app':'#17212f','text.primary':'#eeeeee'}});await until(async()=>await plugin.executeJavaScript('getComputedStyle(document.documentElement).getPropertyValue("--background").trim()==="#17212f"'));pass('JSON-consumes-existing-theme-events',true);
 await control('action','example.json-tree','disable');await until(()=>!current());pass('disable-removes-JSON-instance',true);
 await install(external.jsonV2);await enable('example.json-tree');await viewer('open',{...input,clientId:'json-v2',snapshot:checkpoint});plugin=current();await until(async()=>await plugin.executeJavaScript('document.documentElement.dataset.packageVersion==="0.1.1"&&document.getElementById("status").textContent.includes("个节点")'));pass('independent-update-runs-new-code',true);pass('new-package-rejects-old-checkpoint',await plugin.executeJavaScript('document.getElementById("page").textContent.includes("1 / 1")'));
 await viewer('close','json-v2');jsonBytes=Buffer.from('{"broken":');jsonVersion='invalid';await viewer('open',{...input,clientId:'invalid'});plugin=current();await until(async()=>await plugin.executeJavaScript('document.getElementById("status").dataset.error==="true"'));pass('invalid-JSON-has-visible-error-no-stale-tree',await plugin.executeJavaScript('document.querySelectorAll("#tree .row").length===0'));await viewer('close','invalid');
 await install(external.csvAlternativeZip);await enable('example.csv-alternative');const catalog=await control('catalog');pass('same-format-contributions-keep-distinct-identities',catalog.plugins.filter(item=>item.enabled&&item.viewers.some(v=>v.extensions.includes('csv'))).length===2);
 await viewer('open',{...input,clientId:'csv-alt',viewerId:'example.csv-alternative.table',nodeId:100});plugin=current();await until(async()=>await plugin.executeJavaScript('document.querySelectorAll("td").length===4'));pass('CSV-alternative-uses-the-same-host-contract',true);await viewer('close','csv-alt');
 for(const id of ['example.json-tree','example.csv-alternative','external.notes'])await control('action',id,'uninstall');pass('external-packages-uninstall-cleanly',manager.catalog().plugins.every(item=>item.source==='bundled')&&!current());
 completed=true;
 }catch(error){console.error(error.stack??String(error));}
 finally{await writeFile(path.join(work,'results.json'),JSON.stringify({completed,checks,platform:process.platform,electron:process.versions.electron,external},null,2));console.log(JSON.stringify({completed,work,externalWork:external.work}));parent?.destroy();server?.close();app.exit(completed?0:1);}
})();
