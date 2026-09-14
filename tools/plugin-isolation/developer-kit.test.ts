import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { PluginInstallStore } from '../../electron/service/extensions/plugin-install-store';
describe('portable developer kit',()=>{
 it('generates and packages offline without host imports, and never overwrites an existing project',async()=>{
  const info=JSON.parse(execFileSync(process.execPath,['tools/plugin-isolation/build-developer-kit.mjs'],{encoding:'utf8'}));
  try{
   const target=path.join(info.work,'project');const script=path.join(info.kitDirectory,'create-plugin.mjs');
   execFileSync(process.execPath,[script,'--id','testing.notes','--out',target],{stdio:'pipe'});
   for(const args of [['install','--offline','--ignore-scripts','--no-audit','--no-fund'],['run','build'],['run','package']])execFileSync('npm',args,{cwd:target,stdio:'pipe'});
   const source=await readFile(path.join(target,'src/main.js'),'utf8');expect(source).toContain("from '@omniflow/plugin-sdk'");expect(source).not.toMatch(/from ['"](?:@\/|.*omniflow-app)/);
   const store=new PluginInstallStore(path.join(info.work,'installed'),'darwin');await store.initialize();const review=await store.prepare(path.join(target,'plugin.zip'));expect(review.id).toBe('testing.notes');
   await writeFile(path.join(target,'keep.txt'),'keep');expect(()=>execFileSync(process.execPath,[script,'--id','testing.other','--out',target],{stdio:'pipe'})).toThrow();expect(await readFile(path.join(target,'keep.txt'),'utf8')).toBe('keep');
   expect(()=>execFileSync(process.execPath,[script,'--id','example.csv','--out',path.join(info.work,'reserved')],{stdio:'pipe'})).toThrow();expect(await readdir(info.work)).not.toContain('reserved');
  }finally{await rm(info.work,{recursive:true,force:true});}
 },20000);
});
