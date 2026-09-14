import { app, BrowserWindow, webContents } from 'electron';
import { registerPluginScheme } from '../../electron/service/extensions/isolated-view.ts';
import { registerFirstPartyViewer } from '../../electron/service/extensions/first-party-viewer.ts';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const work=process.env.OMNIFLOW_LAB_WORK;
app.setPath('userData',path.join(work,'profile'));
registerPluginScheme();
app.on('window-all-closed', () => undefined);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test) { const start=Date.now(); while(!await test()) { if(Date.now()-start>10000) throw new Error('Condition timed out'); await delay(50); } }
const checks=[];
function pass(name,value) { assert.ok(value,name);checks.push(name);console.log('PASS '+name); }
void (async()=>{
 let parent,server;let completed=false;
 try {
 await app.whenReady();
 let allowed=true;let metadata='v1';let objectVersion='"v1"';let storageCredentialLeak=false;
 const bytes=Buffer.from(Array.from({length:250},(_,i)=>`row${i},"中文${i}"`).join('\r\n'));
 let origin;
 server=createServer((req,res)=>{
  if(req.url.startsWith('/api/')) {
   if(!allowed || req.headers.authorization!=='Bearer synthetic-token') {res.writeHead(403);res.end();return;}
   let data;
   if(req.url==='/api/v1/user/me') data={id:42};
   else if(req.url==='/api/v1/nodes/99') data={id:99,libraryId:3,type:'file',name:'synthetic.csv',fileSize:bytes.length,storageKey:'key.csv',storageBucket:'bucket',storageProvider:'test',updatedAt:metadata};
   else if(req.url.startsWith('/api/v1/directory/link?')) data=origin+'/bucket/key.csv';
   else {res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'0',data}));return;
  }
  if(req.url==='/bucket/key.csv') {
   if(req.headers.authorization || req.headers.username) storageCredentialLeak=true;
   if(req.headers['if-match'] && req.headers['if-match']!==objectVersion) {res.writeHead(412);res.end();return;}
   const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range??'');if(!match){res.writeHead(400);res.end();return;}
   const start=Number(match[1]),end=Number(match[2]);res.writeHead(206,{'ETag':objectVersion,'Content-Range':`bytes ${start}-${end}/${bytes.length}`});res.end(bytes.subarray(start,end+1));return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 parent=new BrowserWindow({show:false,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(work,'host-preload.cjs')}});
 await parent.loadURL('data:text/html,<h1>Trusted synthetic host</h1>');
 registerFirstPartyViewer(()=>parent,{apiBaseUrl:origin+'/api',storageOrigins:[origin],packageDirectory:process.env.OMNIFLOW_LAB_SAMPLE,preloadPath:path.join(work,'preload.cjs')});
 await parent.webContents.executeJavaScript('window.events=[];electronPluginViewer.subscribe(event=>events.push(event)); true');
 const call=(method,...args)=>parent.webContents.executeJavaScript(`electronPluginViewer.${method}(...${JSON.stringify(args)})`);
 const input={clientId:'test-a',viewerId:'example.csv.table',nodeId:99,libraryId:3,token:'synthetic-token',username:'synthetic',theme:{schemaVersion:1,revision:1,mode:'light',colors:{'surface.app':'#ffffff','text.primary':'#222222'}},snapshot:null};
 pass('real-ipc-to-http-authority-open',(await call('open',input)).ok);
 await call('layout','test-a',{x:10,y:80,width:860,height:580});
 const current=()=>webContents.getAllWebContents().find(wc=>wc.getURL().startsWith('omniflow-extension:'));
 let plugin=current();await until(async()=>await plugin.executeJavaScript('document.getElementById("status").textContent.includes("250")'));
 pass('bounded-paged-csv-render',await plugin.executeJavaScript('document.querySelectorAll("tr").length===100'));
 await plugin.executeJavaScript('document.getElementById("next").click()');
 await until(async()=>await parent.webContents.executeJavaScript('events.some(e=>e.type==="state" && e.snapshot.state.value.page===1)'));
 const snapshot=await parent.webContents.executeJavaScript('events.filter(e=>e.type==="state").at(-1).snapshot');
 await call('close','test-a');await until(()=>!current());
 pass('close-destroys-instance',parent.contentView.children.length===0);
 pass('restore-open',(await call('open',{...input,clientId:'test-b',snapshot})).ok);
 await call('layout','test-b',{x:10,y:80,width:860,height:580});plugin=current();
 await until(async()=>await plugin.executeJavaScript('document.getElementById("page").textContent.includes("2 / 3")'));
 pass('last-checkpoint-restored',await plugin.executeJavaScript('document.querySelector("td").textContent==="row100"'));
 allowed=false;await plugin.executeJavaScript('document.getElementById("reload").click()');
 await until(async()=>await plugin.executeJavaScript('document.getElementById("status").dataset.error==="true"'));
 pass('server-revocation-no-stale-table',await plugin.executeJavaScript('document.querySelectorAll("tr").length===0'));
 await call('close','test-b');allowed=true;
 pass('cross-library-open-denied',!(await call('open',{...input,clientId:'wrong-library',libraryId:4})).ok);
 pass('reopen-after-revocation',(await call('open',{...input,clientId:'test-c'})).ok);plugin=current();
 await until(async()=>await plugin.executeJavaScript('document.getElementById("status").textContent.includes("250")'));
 objectVersion='"v2"';await plugin.executeJavaScript('document.getElementById("reload").click()');
 await until(async()=>await plugin.executeJavaScript('document.getElementById("status").dataset.error==="true"'));
 pass('changed-object-etag-rejected',await plugin.executeJavaScript('document.querySelectorAll("tr").length===0'));
 await call('release');await until(()=>!current());pass('account-release-stops-all',parent.contentView.children.length===0);
 pass('credentials-never-sent-to-storage',!storageCredentialLeak);
 parent.destroy();
 parent=new BrowserWindow({show:false,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(work,'host-preload.cjs')}});
 await parent.loadURL('data:text/html,<h1>Recreated trusted host</h1>');
 pass('main-window-recreation-rebinds-host',(await call('open',{...input,clientId:'new-window'})).ok);
 await call('release');
 completed=true;
 } catch(error) {console.error(error.stack??String(error));}
 finally {await writeFile(path.join(work,'results.json'),JSON.stringify({completed,checks,electron:process.versions.electron,platform:process.platform},null,2));console.log(JSON.stringify({completed,work}));parent?.destroy();server?.close();app.exit(completed?0:1);}
})();
