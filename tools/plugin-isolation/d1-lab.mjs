import { app, BrowserWindow, webContents } from 'electron';
import { registerPluginScheme } from '../../electron/service/extensions/isolated-view.ts';
import { registerFirstPartyViewer } from '../../electron/service/extensions/first-party-viewer.ts';
import { PluginManager } from '../../electron/service/extensions/plugin-manager.ts';
import { registerPluginManagementIpc } from '../../electron/service/extensions/plugin-management-ipc.ts';
import { createServer } from 'node:http';
import { writeFile,readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import assert from 'node:assert/strict';
const work=process.env.OMNIFLOW_LAB_WORK,sample=process.env.OMNIFLOW_LAB_SAMPLE;
app.setPath('userData',path.join(work,'profile'));registerPluginScheme();app.on('window-all-closed',()=>undefined);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,timeout=10000){const start=Date.now();while(!await test()){if(Date.now()-start>timeout)throw new Error('Condition timeout');await delay(30);}}
const checks=[];const pass=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
async function makeZip(id,version,script=''){
 const zip=new JSZip();for(const name of await readdir(sample))zip.file(name,await readFile(path.join(sample,name)));
 const manifest=JSON.parse(await readFile(path.join(sample,'manifest.json'),'utf8'));manifest.id=id;manifest.version=version;manifest.viewers[0].id=id+'.table';manifest.activation=['viewer:'+id+'.table'];
 zip.file('manifest.json',JSON.stringify(manifest));if(script)zip.file('main.js',(await readFile(path.join(sample,'main.js'),'utf8'))+'\n'+script);
 const file=path.join(work,`${id}-${version}.zip`);await writeFile(file,await zip.generateAsync({type:'nodebuffer',platform:'UNIX',compression:'DEFLATE'}));return file;
}
void(async()=>{let parent,server;let completed=false;let manager;
 try{
 await app.whenReady();let origin;const bytes=Buffer.from('a,b\r\n1,2\r\n');
 server=createServer((req,res)=>{
  if(req.url.startsWith('/api/')){
   if(req.headers.authorization!=='Bearer synthetic'){res.writeHead(403);res.end();return;}
   let data;if(req.url==='/api/v1/user/me')data={id:42};else if(req.url==='/api/v1/nodes/99')data={id:99,libraryId:3,name:'synthetic',ext:'csv',type:'file',fileSize:bytes.length,storageKey:'key.csv',storageBucket:'bucket',updatedAt:'v1'};else if(req.url.startsWith('/api/v1/directory/link?'))data=origin+'/bucket/key.csv';else{res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'0',data}));return;
  }
  const range=/bytes=(\d+)-(\d+)/.exec(req.headers.range??'');if(req.url!=='/bucket/key.csv'||!range){res.writeHead(404);res.end();return;}
  const a=Number(range[1]),b=Number(range[2]);res.writeHead(206,{ETag:'"v1"','Content-Range':`bytes ${a}-${b}/${bytes.length}`});res.end(bytes.subarray(a,b+1));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 parent=new BrowserWindow({show:false,width:900,height:650,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(work,'host-preload.cjs')}});await parent.loadURL('data:text/html,<h1>Trusted D1 host</h1>');
 manager=new PluginManager(path.join(work,'plugins'),sample);await manager.initialize();registerPluginManagementIpc(manager,()=>parent);
 registerFirstPartyViewer(()=>parent,{manager,apiBaseUrl:origin+'/api',storageOrigins:[origin],preloadPath:path.join(work,'preload.cjs')});
 const call=(method,...args)=>parent.webContents.executeJavaScript(`electronPluginManagement.${method}(...${JSON.stringify(args)})`);
 const viewer=(method,...args)=>parent.webContents.executeJavaScript(`electronPluginViewer.${method}(...${JSON.stringify(args)})`);
 const input={clientId:'test',viewerId:'local.csv.table',nodeId:99,libraryId:3,token:'synthetic',username:'test',snapshot:null,theme:{schemaVersion:1,revision:1,mode:'light',colors:{'surface.app':'#ffffff','text.primary':'#222222'}}};
 const current=()=>webContents.getAllWebContents().find(wc=>wc.getURL().startsWith('omniflow-extension:'));
 const v1=await makeZip('local.csv','1.0.0');const review=await manager.prepare(v1);
 pass('preflight-does-not-register-or-execute',!(await call('catalog')).plugins.some(p=>p.id==='local.csv')&&!current());
 await call('commit',review.ticket);pass('install-default-disabled',(await call('catalog')).plugins.some(p=>p.id==='local.csv'&&!p.enabled&&!p.readApproved));
 pass('unapproved-open-denied',!(await viewer('open',input)).ok);
 await call('action','local.csv','enable');pass('enabled-alone-is-not-read-approval',!(await viewer('open',input)).ok);await call('action','local.csv','approve-read');
 const opened = await viewer('open',input);if(!opened.ok)console.log(JSON.stringify(opened));pass('managed-package-opens',opened.ok);let plugin=current();await until(async()=>await plugin.executeJavaScript('document.querySelectorAll("td").length===4'));
 pass('read-only-view-is-muted',plugin.isAudioMuted());
 pass('plugin-has-no-management-bridge',await plugin.executeJavaScript('typeof electronPluginManagement === "undefined"'));
 pass('dialogs-cannot-block-host',await plugin.executeJavaScript('alert("synthetic");true'));
 const rpc=(method,params)=>plugin.executeJavaScript(`omniflowTransport.exchange(${JSON.stringify(JSON.stringify({version:1,id:crypto.randomUUID(),method,params}))}).then(JSON.parse)`);
 await rpc('settings.set',{key:'version-test',value:'old-version',expectedRevision:0,schemaVersion:1});
 await call('action','local.csv','disable');await until(()=>!current());pass('disable-stops-instances',manager.catalog().plugins.find(p=>p.id==='local.csv').running===0);
 const v2=await manager.prepare(await makeZip('local.csv','1.0.1'));await call('commit',v2.ticket);await call('action','local.csv','enable');await call('action','local.csv','approve-read');
 await viewer('open',{...input,clientId:'v2'});plugin=current();await until(async()=>await plugin.executeJavaScript('document.querySelectorAll("td").length===4'));pass('updated-version-settings-isolated',(await rpc('settings.get',{key:'version-test'})).value===null);
 await call('action','local.csv','rollback');await call('action','local.csv','enable');await call('action','local.csv','approve-read');await viewer('open',{...input,clientId:'rollback'});plugin=current();await until(async()=>await plugin.executeJavaScript('document.querySelectorAll("td").length===4'));pass('rollback-recovers-old-settings',(await rpc('settings.get',{key:'version-test'})).value.value==='old-version');
 void plugin.executeJavaScript(`const file=document.createElement('input');file.type='file';document.body.append(file);file.click();`,true).catch(()=>undefined);
 await until(()=>manager.catalog().plugins.some(p=>p.id==='local.csv'&&!p.enabled&&p.blockedReason));pass('native-file-picker-cannot-bypass-sdk',!current());
 await call('action','local.csv','enable');
 await viewer('open',{...input,clientId:'post-picker'});
 await call('safeMode',true);await until(()=>!current());pass('safe-mode-blocks-third-party',!(await viewer('open',{...input,clientId:'safe'})).ok);pass('management-remains-available',(await call('catalog')).safeMode);
 await call('safeMode',false);
 const sessions=new Set();for(let index=0;index<70;index++){const result=await viewer('open',{...input,clientId:`repeat-${index}`});assert.ok(result.ok,'Repeated activation');const active=current();sessions.add(active.session);await viewer('close',`repeat-${index}`);}
 pass('seventy-activations-reuse-bounded-sessions',sessions.size<=4&&!current());
 const bad=await manager.prepare(await makeZip('local.hang','1.0.0','setTimeout(()=>{while(true){}},100);'));await call('commit',bad.ticket);await call('action','local.hang','enable');await call('action','local.hang','approve-read');await viewer('open',{...input,clientId:'hang',viewerId:'local.hang.table'});
 await delay(300);pass('management-responsive-during-hang',(await call('catalog')).plugins.some(p=>p.id==='local.hang'));
 await until(()=>manager.catalog().plugins.some(p=>p.id==='local.hang'&&!p.enabled&&p.blockedReason),9000);pass('hung-plugin-quarantined-with-host-alive',(await call('catalog')).plugins.some(p=>p.id==='local.hang'&&p.blockedReason));
 const memory=await manager.prepare(await makeZip('local.memory','1.0.0','setTimeout(()=>{globalThis.retained=new Uint8Array(300*1024*1024);retained.fill(1)},100);'));await call('commit',memory.ticket);await call('action','local.memory','enable');await call('action','local.memory','approve-read');await viewer('open',{...input,clientId:'memory',viewerId:'local.memory.table'});
 await until(()=>manager.catalog().plugins.some(p=>p.id==='local.memory'&&!p.enabled&&p.blockedReason),9000);pass('memory-budget-terminates-plugin',manager.catalog().logs.some(log=>log.pluginId==='local.memory'&&log.code==='memory-budget'));
 await call('action','local.csv','uninstall');pass('uninstall-removes-contribution',(await call('catalog')).plugins.every(p=>p.id!=='local.csv'));
 const reboot=new PluginManager(path.join(work,'plugins'),sample);await reboot.initialize();pass('restart-retains-quarantine-and-install-state',reboot.catalog().plugins.some(p=>p.id==='local.hang'&&!p.enabled)&&!reboot.catalog().plugins.some(p=>p.id==='local.csv'));
 const outsider=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(work,'host-preload.cjs')}});await outsider.loadURL('data:text/html,unbound');pass('unbound-management-source-denied',await outsider.webContents.executeJavaScript('electronPluginManagement.catalog().then(()=>false,()=>true)'));outsider.destroy();
 completed=true;
 }catch(error){console.error(error.stack??String(error));}
 finally{await writeFile(path.join(work,'results.json'),JSON.stringify({completed,checks,platform:process.platform,electron:process.versions.electron,logs:manager?.catalog().logs},null,2));console.log(JSON.stringify({completed,work}));parent?.destroy();server?.close();app.exit(completed?0:1);}
})();
