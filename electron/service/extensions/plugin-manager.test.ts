import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { PluginManager } from './plugin-manager';
import base from '../../../samples/csv-viewer/manifest.json';
const roots:string[]=[];
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'plugin-manager-test-'));roots.push(root);const bundled=path.join(root,'bundled');await mkdir(bundled);await writeFile(path.join(bundled,'manifest.json'),JSON.stringify(base));await writeFile(path.join(bundled,'index.html'),'<p>bundled</p>');return {root,bundled};}
async function zip(root:string,id:string,viewerId=id+'.table'){const archive=new JSZip();archive.file('manifest.json',JSON.stringify({...base,id,version:'1.0.0',viewers:[{...base.viewers[0],id:viewerId}],activation:['viewer:'+viewerId]}));archive.file('index.html','<p>local</p>');const file=path.join(root,id+'.zip');await writeFile(file,await archive.generateAsync({type:'nodebuffer'}));return file;}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
describe('plugin admission and recovery',()=>{
 it('keeps installation, enablement, read approval and forced-safe startup independent',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();const review=await manager.prepare(await zip(f.root,'test.local'));await manager.commit(review.ticket);
  expect(()=>manager.resolve('test.local.table')).toThrow();await manager.action('test.local','enable');expect(()=>manager.resolve('test.local.table')).toThrow();await manager.action('test.local','approve-read');expect(manager.resolve('test.local.table').plugin.id).toBe('test.local');
  await manager.safeMode(true);expect(()=>manager.resolve('test.local.table')).toThrow();expect(manager.resolve('example.csv.table').plugin.source).toBe('bundled');
  const restart=new PluginManager(path.join(f.root,'store'),f.bundled,true);await restart.initialize();await expect(restart.safeMode(false)).rejects.toThrow('STARTUP_SAFE_MODE');expect(restart.catalog().plugins).toHaveLength(2);
 });
 it('rejects duplicate contribution ids across nested plugin namespaces',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();const first=await manager.prepare(await zip(f.root,'parent.plugin','parent.plugin.child.table'));await manager.commit(first.ticket);
  await expect(manager.prepare(await zip(f.root,'parent.plugin.child'))).rejects.toThrow('DUPLICATE_VIEWER_ID');
 });
 it('keeps the recovery catalog usable when storage initialization fails',async()=>{
  const f=await fixture();const root=path.join(f.root,'invalid');await writeFile(root,'not a directory');const manager=new PluginManager(root,f.bundled);await manager.initialize();expect(manager.catalog().safeMode).toBe(true);expect(manager.catalog().plugins.some(item=>item.source==='bundled')).toBe(true);await expect(manager.prepare(await zip(f.root,'test.local'))).rejects.toThrow();
 });
});
