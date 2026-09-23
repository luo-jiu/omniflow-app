import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { mkdtemp, writeFile, readFile, rm, chmod, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginInstallStore } from './plugin-install-store';
import { PluginSettingsStore } from './plugin-settings-store';
import manifestBase from '../../../samples/csv-viewer/manifest.json';
import renameManifest from '../../../samples/batch-rename/manifest.json';
import outputManifest from '../../../samples/csv-export/manifest.json';
const roots:string[]=[];
async function root(){const value=await mkdtemp(path.join(tmpdir(),'omniflow-d1-test-'));roots.push(value);return value;}
function manifest(version='1.0.0'){return {...manifestBase,id:'test.csv',version,viewers:[{...manifestBase.viewers[0],id:'test.csv.table'}],activation:['viewer:test.csv.table']};}
async function archive(directory:string,version='1.0.0',extra?:(zip:JSZip)=>void){const zip=new JSZip();zip.file('manifest.json',JSON.stringify(manifest(version)));zip.file('index.html','<p>synthetic</p>');extra?.(zip);const file=path.join(directory,`package-${version}.zip`);await writeFile(file,await zip.generateAsync({type:'nodebuffer',platform:'UNIX'}));return file;}
afterEach(async()=>{await Promise.all(roots.splice(0).map(value=>rm(value,{recursive:true,force:true})));});
describe('transactional plugin installation',()=>{
 it('prepares without registration, installs disabled and survives restart',async()=>{
  const dir=await root();const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await store.initialize();
  const review=await store.prepare(await archive(dir));expect(store.snapshot().plugins).toHaveLength(0);expect(review.addedPermissions).toEqual(['resource.read']);
  await store.commit(review.ticket,()=>undefined);expect(store.snapshot().plugins[0]).toMatchObject({enabled:false,readApproved:false});
  await store.action('test.csv','enable',()=>undefined);await store.action('test.csv','approve-read',()=>undefined);
  const restarted=new PluginInstallStore(path.join(dir,'store'),'darwin');await restarted.initialize();expect(restarted.snapshot().plugins[0]).toMatchObject({enabled:true,readApproved:true});await restarted.verify(restarted.snapshot().plugins[0]);
 });
 it('rejects unsafe archives without changing installed records',async()=>{
  const dir=await root();const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await store.initialize();
  const cases:Array<(zip:JSZip)=>void>=[zip=>zip.file('../escape.js','x'),zip=>zip.file('link.js','target',{unixPermissions:0o120777}),zip=>zip.file('node.node','x'),zip=>{zip.file('A/x.js','x');zip.file('a/y.js','y');},zip=>zip.file('huge.js',Buffer.alloc(1048577)),zip=>zip.file('manifest.json',JSON.stringify({...manifest(),sdkVersion:2}))];
  for(const [index,mutate] of cases.entries()){await expect(store.prepare(await archive(dir,`1.0.${index}`,mutate))).rejects.toThrow();expect(store.snapshot().plugins).toHaveLength(0);}
  expect(await readdir(path.join(dir,'store/staging'))).toHaveLength(0);
 });
 it('detects staging tampering and conflicting prepared updates',async()=>{
  const dir=await root();const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await store.initialize();
  const review=await store.prepare(await archive(dir));await writeFile(path.join(dir,'store/staging',review.ticket,'index.html'),'changed');await expect(store.commit(review.ticket,()=>undefined)).rejects.toThrow('STAGING_CHANGED');await store.discard(review.ticket);
  const initial=await store.prepare(await archive(dir));await store.commit(initial.ticket,()=>undefined);
  const a=await store.prepare(await archive(dir,'1.0.1'));const b=await store.prepare(await archive(dir,'1.0.2'));await store.commit(a.ticket,()=>undefined);await expect(store.commit(b.ticket,()=>undefined)).rejects.toThrow('INSTALL_CONFLICT');
 });
 it('keeps a verified rollback and resets activation and approval on update',async()=>{
  const dir=await root();const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await store.initialize();
  for(const version of ['1.0.0','1.0.1']){const review=await store.prepare(await archive(dir,version));await store.commit(review.ticket,()=>undefined);}
  expect(store.snapshot().plugins[0]).toMatchObject({enabled:false,readApproved:false,previous:{manifest:{version:'1.0.0'}}});
  await store.action('test.csv','rollback',()=>undefined);expect(store.snapshot().plugins[0].manifest.version).toBe('1.0.0');
  await expect(store.prepare(await archive(dir,'1.0.0'))).rejects.toThrow('VERSION_NOT_NEWER');
 });
 it('retains the old index and code when index replacement fails',async()=>{
  const dir=await root();const folder=path.join(dir,'store');const initial=new PluginInstallStore(folder,'darwin');await initial.initialize();const first=await initial.prepare(await archive(dir));await initial.commit(first.ticket,()=>undefined);
  const original=await readFile(path.join(folder,'index.json'),'utf8');
  const failing=new PluginInstallStore(folder,'darwin',async()=>{throw new Error('disk failure');});await failing.initialize();const update=await failing.prepare(await archive(dir,'1.0.1'));await expect(failing.commit(update.ticket,()=>undefined)).rejects.toThrow('disk failure');
  expect(await readFile(path.join(folder,'index.json'),'utf8')).toBe(original);await failing.verify(failing.snapshot().plugins[0]);
 });
 it('fails closed on corrupt records and tampered installed bytes',async()=>{
  const dir=await root();const folder=path.join(dir,'store');const store=new PluginInstallStore(folder,'darwin');await store.initialize();const review=await store.prepare(await archive(dir));await store.commit(review.ticket,()=>undefined);const installed=store.snapshot().plugins[0];
  const file=path.join(store.directory(installed.fingerprint),'index.html');await chmod(file,0o600);await writeFile(file,'tampered');await expect(store.verify(installed)).rejects.toThrow('INTEGRITY_FAILED');
  await writeFile(path.join(folder,'index.json'),'broken');const restarted=new PluginInstallStore(folder,'darwin');await restarted.initialize();expect(restarted.snapshot().safeMode).toBe(true);expect(restarted.recoveryReason).toBeTruthy();
 });
 it('rejects a symlinked installation subdirectory before cleanup',async()=>{const dir=await root();const outside=path.join(dir,'outside');await mkdir(outside);await mkdir(path.join(dir,'store'));await symlink(outside,path.join(dir,'store/staging'));const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await expect(store.initialize()).rejects.toThrow('INVALID_INSTALL_ROOT');});
 it('persists safe mode and quarantined failures',async()=>{const dir=await root();const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await store.initialize();const review=await store.prepare(await archive(dir));await store.commit(review.ticket,()=>undefined);await store.action('test.csv','enable',()=>undefined);await store.recordFailure('test.csv','heartbeat-timeout');await store.setSafeMode(true,()=>undefined);const next=new PluginInstallStore(path.join(dir,'store'),'darwin');await next.initialize();expect(next.snapshot()).toMatchObject({safeMode:true,plugins:[{enabled:false,failure:'heartbeat-timeout'}]});});
});
describe('persistent version-isolated settings',()=>{
 it('backs up corrupt settings before an explicit reset',async()=>{const dir=await root();await writeFile(path.join(dir,'settings.json'),'corrupt');const store=new PluginSettingsStore(dir);await store.initialize();expect(store.needsRecovery).toBe(true);await store.backupAndReset();expect(store.needsRecovery).toBe(false);const backup=(await readdir(dir)).find(name=>name.startsWith('settings-corrupt-'))!;expect(await readFile(path.join(dir,backup),'utf8')).toBe('corrupt');});
 it('persists CAS settings, separates package versions and keeps data after uninstall',async()=>{
  const dir=await root();const store=new PluginSettingsStore(dir);await store.initialize();const scope=JSON.stringify(['test.csv','account',3]);const one=store.forPackage('test.csv','a'.repeat(64));const two=store.forPackage('test.csv','b'.repeat(64));
  await one.set(scope,'display',{compact:true},0,1);await expect(one.set(scope,'display',{},0,1)).rejects.toMatchObject({code:'CONFLICT'});expect(await two.get(scope,'display')).toBeNull();
  const next=new PluginSettingsStore(dir);await next.initialize();expect(await next.forPackage('test.csv','a'.repeat(64)).get(scope,'display')).toMatchObject({value:{compact:true}});
  await next.clearPlugin('test.csv');expect(await next.forPackage('test.csv','a'.repeat(64)).get(scope,'display')).toBeNull();
 });
});

describe('independent Agent Tool install approval',()=>{
 it('persists output approval and revokes it on upgrade, rollback and missing historical flags',async()=>{
  const dir=await root();const folder=path.join(dir,'store');const store=new PluginInstallStore(folder,'darwin');await store.initialize();
  async function install(version:string){const review=await store.prepare(await archive(dir,version,zip=>{zip.file('manifest.json',JSON.stringify({...outputManifest,version}));zip.file('tool.html','<p>export</p>');}));await store.commit(review.ticket,()=>undefined);}
  await install('1.0.0');await store.action(outputManifest.id,'approve-output',()=>undefined);
  const restarted=new PluginInstallStore(folder,'darwin');await restarted.initialize();expect(restarted.snapshot().plugins[0].outputApproved).toBe(true);
  await install('1.0.1');expect(store.snapshot().plugins[0].outputApproved).toBe(false);
  await store.action(outputManifest.id,'approve-output',()=>undefined);await store.action(outputManifest.id,'rollback',()=>undefined);expect(store.snapshot().plugins[0].outputApproved).toBe(false);
  const index=JSON.parse(await readFile(path.join(folder,'index.json'),'utf8'));delete index.plugins[0].outputApproved;await writeFile(path.join(folder,'index.json'),JSON.stringify(index));
  const legacy=new PluginInstallStore(folder,'darwin');await legacy.initialize();expect(legacy.snapshot().plugins[0].outputApproved).toBe(false);
  index.plugins[0].outputApproved='yes';await writeFile(path.join(folder,'index.json'),JSON.stringify(index));const corrupt=new PluginInstallStore(folder,'darwin');await corrupt.initialize();expect(corrupt.snapshot().safeMode).toBe(true);
 });
 it('persists rename approval only for the current package and resets on upgrade and rollback',async()=>{
  const dir=await root();const folder=path.join(dir,'store');const store=new PluginInstallStore(folder,'darwin');await store.initialize();
  async function install(version:string){const review=await store.prepare(await archive(dir,version,zip=>{zip.file('manifest.json',JSON.stringify({...renameManifest,version}));zip.file('tool.html','<p>rename</p>');}));await store.commit(review.ticket,()=>undefined);}
  await install('1.0.0');expect(store.snapshot().plugins[0].renameApproved).toBe(false);
  await store.action(renameManifest.id,'approve-rename',()=>undefined);await store.action(renameManifest.id,'approve-tools',()=>undefined);
  const restart=new PluginInstallStore(folder,'darwin');await restart.initialize();expect(restart.snapshot().plugins[0]).toMatchObject({renameApproved:true,readApproved:false,toolApproved:true});
  await install('1.0.1');expect(store.snapshot().plugins[0]).toMatchObject({renameApproved:false,readApproved:false,toolApproved:false});
  await store.action(renameManifest.id,'approve-rename',()=>undefined);await store.action(renameManifest.id,'rollback',()=>undefined);
  expect(store.snapshot().plugins[0]).toMatchObject({renameApproved:false,toolApproved:false,manifest:{version:'1.0.0'}});
 });
 it('migrates missing rename approval to false and rejects a malformed approval value',async()=>{
  const dir=await root();const folder=path.join(dir,'store');const store=new PluginInstallStore(folder,'darwin');await store.initialize();
  const review=await store.prepare(await archive(dir));await store.commit(review.ticket,()=>undefined);
  const index=JSON.parse(await readFile(path.join(folder,'index.json'),'utf8'));delete index.plugins[0].renameApproved;await writeFile(path.join(folder,'index.json'),JSON.stringify(index));
  const restart=new PluginInstallStore(folder,'darwin');await restart.initialize();expect(restart.snapshot().plugins[0].renameApproved).toBe(false);
  await expect(restart.action('test.csv','approve-rename',()=>undefined)).rejects.toThrow('CAPABILITY_NOT_DECLARED');
  index.plugins[0].renameApproved='yes';await writeFile(path.join(folder,'index.json'),JSON.stringify(index));
  const invalid=new PluginInstallStore(folder,'darwin');await invalid.initialize();expect(invalid.snapshot().safeMode).toBe(true);expect(invalid.recoveryReason).toBeTruthy();
 });
 function toolsManifest(id='test.csv',version='1.0.0',toolId=id+'.read'){
  return {...manifest(version),formatVersion:2,id,viewers:[],activation:['tool:'+toolId],permissions:['resource.read','agent.tools'],agentTools:[{id:toolId,title:'文件分析',description:'分析本次授权文件',entry:'index.html',inputSchema:{type:'object',properties:{resource:{type:'object',properties:{nodeId:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},required:['nodeId'],additionalProperties:false}},required:['resource'],additionalProperties:false},outputSchema:{type:'object',properties:{},required:[],additionalProperties:false},resourceAccess:[{parameter:'resource',mode:'read',kind:'file'}],timeoutMs:1000,maxResultBytes:1024}]};
 }
 it('migrates old records without granting Tools and keeps viewer package integrity valid',async()=>{
  const dir=await root();const folder=path.join(dir,'store');const store=new PluginInstallStore(folder,'darwin');await store.initialize();
  const review=await store.prepare(await archive(dir));await store.commit(review.ticket,()=>undefined);await store.action('test.csv','approve-read',()=>undefined);
  const index=JSON.parse(await readFile(path.join(folder,'index.json'),'utf8'));delete index.plugins[0].toolApproved;delete index.plugins[0].manifest.agentTools;index.bundled={enabled:true,readApproved:true};
  await writeFile(path.join(folder,'index.json'),JSON.stringify(index));
  const restart=new PluginInstallStore(folder,'darwin');await restart.initialize();expect(restart.snapshot().plugins[0]).toMatchObject({readApproved:true,toolApproved:false});expect(restart.snapshot().bundled).toMatchObject({toolApproved:false});await restart.verify(restart.snapshot().plugins[0]);
  await expect(restart.action('test.csv','approve-tools',()=>undefined)).rejects.toThrow('CAPABILITY_NOT_DECLARED');
 });
 it('persists separate Tool approval and resets it after update and rollback',async()=>{
  const dir=await root();const folder=path.join(dir,'store');const store=new PluginInstallStore(folder,'darwin');await store.initialize();
  const first=await store.prepare(await archive(dir,'1.0.0',zip=>zip.file('manifest.json',JSON.stringify(toolsManifest()))));await store.commit(first.ticket,()=>undefined);
  await store.action('test.csv','approve-read',()=>undefined);expect(store.snapshot().plugins[0].toolApproved).toBe(false);await store.action('test.csv','approve-tools',()=>undefined);
  const restart=new PluginInstallStore(folder,'darwin');await restart.initialize();expect(restart.snapshot().plugins[0].toolApproved).toBe(true);
  const second=await restart.prepare(await archive(dir,'1.0.1',zip=>zip.file('manifest.json',JSON.stringify(toolsManifest('test.csv','1.0.1')))));await restart.commit(second.ticket,()=>undefined);expect(restart.snapshot().plugins[0]).toMatchObject({enabled:false,readApproved:false,toolApproved:false});
  await restart.action('test.csv','approve-tools',()=>undefined);await restart.action('test.csv','rollback',()=>undefined);expect(restart.snapshot().plugins[0]).toMatchObject({enabled:false,readApproved:false,toolApproved:false,manifest:{version:'1.0.0'}});
 });
 it('rejects Provider collisions against installed and reserved tool names before installation',async()=>{
  const dir=await root();const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await store.initialize();
  const first=await store.prepare(await archive(dir,'1.0.0',zip=>zip.file('manifest.json',JSON.stringify(toolsManifest('test.a','1.0.0','test.a.b.c')))));await store.commit(first.ticket,()=>undefined);
  await expect(store.prepare(await archive(dir,'1.0.1',zip=>zip.file('manifest.json',JSON.stringify(toolsManifest('test.a.b','1.0.0','test.a.b.c')))))).rejects.toThrow('DUPLICATE_TOOL_ID');
  store.setReservedToolNames(['test_new_read']);
  await expect(store.prepare(await archive(dir,'1.0.2',zip=>zip.file('manifest.json',JSON.stringify(toolsManifest('test.new')))))).rejects.toThrow('PLUGIN_TOOL_PROVIDER_NAME_CONFLICT');
 });
 it('rejects workspace IDs that collide with installed workspace, command or Viewer identities',async()=>{
  const dir=await root();const store=new PluginInstallStore(path.join(dir,'store'),'darwin');await store.initialize();
  function workspaceManifest(id:string,workspaceId:string){const base=toolsManifest(id);return {...base,commands:[{id:id+'.run',title:'Run',toolId:base.agentTools[0].id,locations:['tool-workspace']}],workspaces:[{id:workspaceId,title:'Page',entry:'index.html',commandId:id+'.run'}],activation:[...base.activation,'workspace:'+workspaceId]};}
  const first=workspaceManifest('test.a','test.a.b.page');const review=await store.prepare(await archive(dir,'1.0.0',zip=>zip.file('manifest.json',JSON.stringify(first))));await store.commit(review.ticket,()=>undefined);
  await expect(store.prepare(await archive(dir,'1.0.1',zip=>zip.file('manifest.json',JSON.stringify(workspaceManifest('test.a.b','test.a.b.page')))))).rejects.toThrow('DUPLICATE_WORKSPACE_ID');
  const viewer={...manifest(),id:'test.a.b',viewers:[{id:'test.a.b.page',title:'CSV',extensions:['csv']}],activation:['viewer:test.a.b.page']};
  await expect(store.prepare(await archive(dir,'1.0.2',zip=>zip.file('manifest.json',JSON.stringify(viewer))))).rejects.toThrow('DUPLICATE_WORKSPACE_ID');
  const command={...toolsManifest('test.a.b'),commands:[{id:'test.a.b.page',title:'Run',toolId:'test.a.b.read',locations:['tool-workspace']}]};
  await expect(store.prepare(await archive(dir,'1.0.3',zip=>zip.file('manifest.json',JSON.stringify(command))))).rejects.toThrow('DUPLICATE_WORKSPACE_ID');
  expect(store.snapshot().plugins).toHaveLength(1);
  const restart=new PluginInstallStore(path.join(dir,'store'),'darwin');await restart.initialize();expect(restart.snapshot().plugins[0].manifest.workspaces).toEqual(first.workspaces);
 });
});
