import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { PluginManager } from './plugin-manager';
import base from '../../../samples/csv-viewer/manifest.json';
import renameManifest from '../../../samples/batch-rename/manifest.json';
import outputManifest from '../../../samples/csv-export/manifest.json';
import { isPluginWorkspaceAllowed } from '../../../src/shared/plugin-management';
const roots:string[]=[];
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'plugin-manager-test-'));roots.push(root);const bundled=path.join(root,'bundled');await mkdir(bundled);await writeFile(path.join(bundled,'manifest.json'),JSON.stringify(base));await writeFile(path.join(bundled,'index.html'),'<p>bundled</p>');return {root,bundled};}
async function zip(root:string,id:string,viewerId=id+'.table'){const archive=new JSZip();archive.file('manifest.json',JSON.stringify({...base,id,version:'1.0.0',viewers:[{...base.viewers[0],id:viewerId}],activation:['viewer:'+viewerId]}));archive.file('index.html','<p>local</p>');const file=path.join(root,id+'.zip');await writeFile(file,await archive.generateAsync({type:'nodebuffer'}));return file;}
async function toolZip(root:string, version='1.0.0') {
 const archive=new JSZip();
 const tool={id:'test.tools.read',title:'Read Tool',description:'分析获准文件',entry:'tool.html',inputSchema:{type:'object',properties:{resource:{type:'object',properties:{nodeId:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},required:['nodeId'],additionalProperties:false}},required:['resource'],additionalProperties:false},outputSchema:{type:'object',properties:{},required:[],additionalProperties:false},resourceAccess:[{parameter:'resource',mode:'read',kind:'file'}],timeoutMs:1000,maxResultBytes:1024};
 archive.file('manifest.json',JSON.stringify({...base,formatVersion:2,id:'test.tools',version,viewers:[],agentTools:[tool],permissions:['resource.read','agent.tools'],activation:['tool:test.tools.read']}));
 archive.file('index.html','<p>unused viewer</p>');archive.file('tool.html','<p>tool</p>');
 const file=path.join(root,'tools-'+version+'.zip');await writeFile(file,await archive.generateAsync({type:'nodebuffer'}));return file;
}
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

describe('plugin tool admission and runtime broadcasts',()=>{
 it('projects and resolves workspace pages through manual capability grants and package identity',async()=>{
  const f=await fixture();const root=path.join(f.root,'store');const manager=new PluginManager(root,f.bundled);await manager.initialize();
  const workspace={id:outputManifest.id+'.workspace',title:'Export',entry:'workspace.html',commandId:outputManifest.commands[0].id};
  const archive=new JSZip();archive.file('manifest.json',JSON.stringify({...outputManifest,permissions:['resource.read','resource.output.propose'],workspaces:[workspace],activation:[...outputManifest.activation,'workspace:'+workspace.id]}));archive.file('tool.html','<p>export</p>');archive.file('workspace.html','<p>workspace</p>');
  const source=path.join(f.root,'workspace.zip');await writeFile(source,await archive.generateAsync({type:'nodebuffer'}));const review=await manager.prepare(source);await manager.commit(review.ticket);
  expect(()=>manager.resolveWorkspace(workspace.id)).toThrow('PLUGIN_BLOCKED');
  for(const action of ['enable','approve-read'] as const)await manager.action(outputManifest.id,action);
  expect(()=>manager.resolveWorkspace(workspace.id)).toThrow('PLUGIN_BLOCKED');await manager.action(outputManifest.id,'approve-output');
  const current=manager.resolveWorkspace(workspace.id,review.fingerprint);
  expect(current).toMatchObject({plugin:{workspaces:[workspace],toolApproved:false},workspace});
  expect(isPluginWorkspaceAllowed(current.plugin,{...workspace,entry:'foreign.html'})).toBe(false);
  expect(isPluginWorkspaceAllowed({...current.plugin,commands:[]},workspace)).toBe(false);
  expect(isPluginWorkspaceAllowed({...current.plugin,workspaces:[]},workspace)).toBe(false);
  expect(manager.stillWorkspaceAllowed(workspace.id,review.fingerprint)).toBe(true);
  expect(manager.stillWorkspaceAllowed(workspace.id,'f'.repeat(64))).toBe(false);
  expect(()=>manager.resolveWorkspace(workspace.id,'f'.repeat(64))).toThrow('PLUGIN_VERSION_CHANGED');
  expect(manager.toolSnapshot()).toEqual([]);
  const restart=new PluginManager(root,f.bundled);await restart.initialize();expect(restart.resolveWorkspace(workspace.id).workspace).toEqual(workspace);
  const stopped=vi.fn();manager.attachRuntime(stopped);await manager.action(outputManifest.id,'revoke-output');
  expect(stopped).toHaveBeenCalledWith(outputManifest.id);expect(manager.stillWorkspaceAllowed(workspace.id,review.fingerprint)).toBe(false);
  await manager.action(outputManifest.id,'approve-output');await manager.safeMode(true);expect(manager.stillWorkspaceAllowed(workspace.id,review.fingerprint)).toBe(false);
 });
 it('projects manual commands and checks their own capability grants without authorizing the Agent',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  const archive=new JSZip();archive.file('manifest.json',JSON.stringify({...outputManifest,permissions:['resource.read','resource.output.propose']}));archive.file('tool.html','<p>manual export</p>');
  const source=path.join(f.root,'manual-export.zip');await writeFile(source,await archive.generateAsync({type:'nodebuffer'}));
  const review=await manager.prepare(source);await manager.commit(review.ticket);
  for(const action of ['enable','approve-read'] as const)await manager.action(outputManifest.id,action);
  const toolId=outputManifest.agentTools[0].id;
  expect(()=>manager.resolveTool(toolId,undefined,'command')).toThrow('PLUGIN_BLOCKED');
  await manager.action(outputManifest.id,'approve-output');
  const current=manager.resolveTool(toolId,undefined,'command');
  expect(current.plugin).toMatchObject({commands:outputManifest.commands,toolApproved:false});
  expect(manager.stillToolAllowed(toolId,current.plugin.fingerprint,'command')).toBe(true);
  expect(manager.stillToolAllowed(toolId,current.plugin.fingerprint)).toBe(false);
  expect(()=>manager.resolveTool(toolId)).toThrow('PLUGIN_BLOCKED');
  await expect(manager.action(outputManifest.id,'approve-tools')).rejects.toThrow('CAPABILITY_NOT_DECLARED');
  expect(()=>manager.resolveTool(toolId,'0'.repeat(64),'command')).toThrow('PLUGIN_VERSION_CHANGED');
  await manager.safeMode(true);expect(manager.stillToolAllowed(toolId,current.plugin.fingerprint,'command')).toBe(false);
  await manager.safeMode(false);expect(manager.stillToolAllowed(toolId,current.plugin.fingerprint,'command')).toBe(true);
  await manager.action(outputManifest.id,'revoke-output');expect(manager.stillToolAllowed(toolId,current.plugin.fingerprint,'command')).toBe(false);
 });
 it('rejects a command that collides with another installed contribution in a nested namespace',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  const existing=await manager.prepare(await zip(f.root,'test.tools.child'));await manager.commit(existing.ticket);
  const archive=await JSZip.loadAsync(await readFile(await toolZip(f.root)));
  const manifest=JSON.parse(await archive.file('manifest.json')!.async('string'));
  manifest.commands=[{id:'test.tools.child.table',title:'冲突入口',toolId:'test.tools.read',locations:['file-menu']}];
  archive.file('manifest.json',JSON.stringify(manifest));const source=path.join(f.root,'conflicting-command.zip');await writeFile(source,await archive.generateAsync({type:'nodebuffer'}));
  await expect(manager.prepare(source)).rejects.toThrow('DUPLICATE_COMMAND_ID');
 });
 it('requires independent file output approval in addition to read and Agent Tool grants',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  const archive=new JSZip();archive.file('manifest.json',JSON.stringify(outputManifest));archive.file('tool.html','<p>export</p>');
  const packagePath=path.join(f.root,'export.zip');await writeFile(packagePath,await archive.generateAsync({type:'nodebuffer'}));
  const review=await manager.prepare(packagePath);await manager.commit(review.ticket);
  for(const action of ['enable','approve-read','approve-tools'] as const)await manager.action(outputManifest.id,action);
  expect(manager.toolSnapshot()).toEqual([]);expect(manager.catalog().plugins.find(item=>item.id===outputManifest.id)?.outputApproved).toBe(false);
  await manager.action(outputManifest.id,'approve-output');expect(manager.resolveTool(outputManifest.agentTools[0].id).plugin.outputApproved).toBe(true);
  const stop=vi.fn();manager.attachRuntime(stop);await manager.action(outputManifest.id,'revoke-output');expect(stop).toHaveBeenCalledWith(outputManifest.id);expect(manager.toolSnapshot()).toEqual([]);
  await expect(manager.action('example.csv','approve-output')).rejects.toThrow('CAPABILITY_NOT_DECLARED');
 });
 it('admits metadata-only rename proposals only after independent approval and revokes active runtimes',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  const archive=new JSZip();archive.file('manifest.json',JSON.stringify(renameManifest));archive.file('tool.html','<p>rename proposal</p>');
  const source=path.join(f.root,'rename.zip');await writeFile(source,await archive.generateAsync({type:'nodebuffer'}));
  const review=await manager.prepare(source);await manager.commit(review.ticket);await manager.action(renameManifest.id,'enable');await manager.action(renameManifest.id,'approve-tools');
  expect(manager.toolSnapshot()).toEqual([]);await expect(manager.action(renameManifest.id,'approve-read')).rejects.toThrow('CAPABILITY_NOT_DECLARED');
  await manager.action(renameManifest.id,'approve-rename');const resolved=manager.resolveTool(renameManifest.agentTools[0].id);
  expect(resolved.plugin).toMatchObject({readApproved:false,renameApproved:true,toolApproved:true});
  expect(manager.stillToolAllowed(renameManifest.agentTools[0].id,resolved.plugin.fingerprint)).toBe(true);
  const stop=vi.fn();manager.attachRuntime(stop);await manager.action(renameManifest.id,'revoke-rename');
  expect(stop).toHaveBeenCalledWith(renameManifest.id);expect(manager.toolSnapshot()).toEqual([]);
  expect(manager.stillToolAllowed(renameManifest.agentTools[0].id,resolved.plugin.fingerprint)).toBe(false);
  await expect(manager.action('example.csv','approve-rename')).rejects.toThrow('CAPABILITY_NOT_DECLARED');
 });
 it('requires separate Tool approval, invalidates old identities and preserves immutable snapshots',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  const stopped=vi.fn();const stoppedOther=vi.fn();manager.attachRuntime(stopped);manager.attachRuntime(stoppedOther);
  const review=await manager.prepare(await toolZip(f.root));await manager.commit(review.ticket);
  await manager.action('test.tools','enable');await manager.action('test.tools','approve-read');
  expect(manager.catalog().plugins.find(p=>p.id==='test.tools')).toMatchObject({toolApproved:false,viewers:[]});
  expect(()=>manager.resolveTool('test.tools.read')).toThrow('PLUGIN_BLOCKED');
  await manager.action('test.tools','approve-tools');const frozen=manager.toolSnapshot();const initial=manager.resolveTool('test.tools.read');
  expect(manager.stillToolAllowed('test.tools.read',initial.plugin.fingerprint)).toBe(true);
  expect(()=>manager.resolveTool('test.tools.read','0'.repeat(64))).toThrow('PLUGIN_VERSION_CHANGED');
  await manager.action('test.tools','revoke-tools');expect(manager.stillToolAllowed('test.tools.read',initial.plugin.fingerprint)).toBe(false);expect(frozen).toHaveLength(1);
  await manager.action('test.tools','approve-tools');await manager.action('test.tools','revoke-read');expect(manager.toolSnapshot()).toEqual([]);
  const update=await manager.prepare(await toolZip(f.root,'1.0.1'));stopped.mockClear();stoppedOther.mockClear();await manager.commit(update.ticket);
  expect(stopped).toHaveBeenCalledWith('test.tools');expect(stoppedOther).toHaveBeenCalledWith('test.tools');
  expect(manager.catalog().plugins.find(p=>p.id==='test.tools')).toMatchObject({enabled:false,readApproved:false,toolApproved:false});
  await manager.action('test.tools','enable');await manager.action('test.tools','approve-read');await manager.action('test.tools','approve-tools');
  expect(manager.stillToolAllowed('test.tools.read',initial.plugin.fingerprint)).toBe(false);
  expect(manager.resolveTool('test.tools.read').registrationId).not.toBe(initial.registrationId);
  stopped.mockClear();stoppedOther.mockClear();await manager.action('test.tools','rollback');expect(stopped).toHaveBeenCalledWith('test.tools');expect(stoppedOther).toHaveBeenCalledWith('test.tools');expect(manager.toolSnapshot()).toEqual([]);
 });
 it('checks live Tool admission without rebuilding the frozen contribution catalog',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  const review=await manager.prepare(await toolZip(f.root));await manager.commit(review.ticket);
  await manager.action('test.tools','enable');await manager.action('test.tools','approve-read');await manager.action('test.tools','approve-tools');
  const initial=manager.resolveTool('test.tools.read');const snapshot=vi.spyOn(manager,'toolSnapshot');
  expect(manager.stillToolAllowed('test.tools.read',initial.plugin.fingerprint)).toBe(true);
  expect(manager.stillToolAllowed('test.tools.missing',initial.plugin.fingerprint)).toBe(false);
  await manager.action('test.tools','revoke-tools');expect(manager.stillToolAllowed('test.tools.read',initial.plugin.fingerprint)).toBe(false);
  await manager.action('test.tools','approve-tools');await manager.action('test.tools','revoke-read');expect(manager.stillToolAllowed('test.tools.read',initial.plugin.fingerprint)).toBe(false);
  const update=await manager.prepare(await toolZip(f.root,'1.0.1'));await manager.commit(update.ticket);
  await manager.action('test.tools','enable');await manager.action('test.tools','approve-read');await manager.action('test.tools','approve-tools');
  const current=manager.catalog().plugins.find(plugin=>plugin.id==='test.tools')!;
  expect(manager.stillToolAllowed('test.tools.read',initial.plugin.fingerprint)).toBe(false);
  expect(manager.stillToolAllowed('test.tools.read',current.fingerprint)).toBe(true);
  expect(snapshot).not.toHaveBeenCalled();snapshot.mockRestore();
 });
 it('broadcasts lifecycle changes to all runtimes and allows an individual runtime to detach',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  const first=vi.fn();const second=vi.fn();const detach=manager.attachRuntime(first);manager.attachRuntime(second);
  await manager.action('example.csv','revoke-read');expect(first).toHaveBeenCalledWith('example.csv');expect(second).toHaveBeenCalledWith('example.csv');
  first.mockClear();second.mockClear();detach();await manager.repairSettings();expect(first).not.toHaveBeenCalled();expect(second).toHaveBeenCalledWith(undefined);
 });
 it('continues stopping other runtimes after failure and persists blocked admission',async()=>{
  const f=await fixture();const store=path.join(f.root,'store');const manager=new PluginManager(store,f.bundled);await manager.initialize();
  const review=await manager.prepare(await zip(f.root,'test.local'));await manager.commit(review.ticket);await manager.action('test.local','enable');await manager.action('test.local','approve-read');
  const second=vi.fn();manager.attachRuntime(()=>{throw new Error('unexpected stop');});manager.attachRuntime(second);
  await expect(manager.action('test.local','revoke-read')).rejects.toThrow('RUNTIME_STOP_FAILED');
  expect(second).toHaveBeenCalledWith('test.local');expect(()=>manager.resolve('test.local.table')).toThrow('PLUGIN_BLOCKED');
  expect(manager.installs.snapshot().plugins[0]).toMatchObject({enabled:false,failure:'runtime-stop-failed'});
  const restart=new PluginManager(store,f.bundled);await restart.initialize();expect(()=>restart.resolve('test.local.table')).toThrow('PLUGIN_BLOCKED');
 });
 it('continues global recovery stopping across plugins even when one runtime fails',async()=>{
  const f=await fixture();const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();
  for(const id of ['test.first','test.second']){const review=await manager.prepare(await zip(f.root,id));await manager.commit(review.ticket);await manager.action(id,'enable');await manager.action(id,'approve-read');}
  const stopped:string[]=[];manager.attachRuntime(id=>{if(id==='test.first')throw new Error('stop failed');});manager.attachRuntime(id=>{if(id)stopped.push(id);});
  await expect(manager.safeMode(true)).rejects.toThrow('RUNTIME_STOP_FAILED');expect(stopped).toEqual(['test.first','test.second']);expect(manager.catalog().safeMode).toBe(true);
  expect(manager.installs.snapshot().plugins.find(p=>p.manifest.id==='test.first')?.enabled).toBe(false);
 });
});

describe('bundled Tool approval identity',()=>{
 it('does not transfer Tool approval to changed bundled code',async()=>{
  const f=await fixture();const archive=await JSZip.loadAsync(await readFile(await toolZip(f.root)));
  const manifest=JSON.parse(await archive.file('manifest.json')!.async('string'));manifest.id='example.csv';manifest.agentTools[0].id='example.csv.read';manifest.activation=['tool:example.csv.read'];
  await writeFile(path.join(f.bundled,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(f.bundled,'tool.html'),'<p>tool</p>');
  const manager=new PluginManager(path.join(f.root,'store'),f.bundled);await manager.initialize();expect(manager.catalog().plugins[0].toolApproved).toBe(false);
  await manager.action('example.csv','approve-tools');expect(manager.resolveTool('example.csv.read')).toBeTruthy();
  await writeFile(path.join(f.bundled,'tool.html'),'<p>changed implementation</p>');
  const restart=new PluginManager(path.join(f.root,'store'),f.bundled);await restart.initialize();expect(restart.catalog().plugins[0].toolApproved).toBe(false);expect(()=>restart.resolveTool('example.csv.read')).toThrow('PLUGIN_BLOCKED');
 });
});
