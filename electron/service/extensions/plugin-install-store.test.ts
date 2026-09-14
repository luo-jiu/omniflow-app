import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { mkdtemp, writeFile, readFile, rm, chmod, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginInstallStore } from './plugin-install-store';
import { PluginSettingsStore } from './plugin-settings-store';
import manifestBase from '../../../samples/csv-viewer/manifest.json';
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
