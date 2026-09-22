import { cp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const args=process.argv.slice(2);if(args.includes('--help')){console.log('node create-plugin.mjs --id your.viewer --out /absolute/new-project --extension txt');process.exit(0);}
const options={};for(let i=0;i<args.length;i+=2){if(!['--id','--out','--extension'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('参数无效，请使用 --help');options[args[i]]=args[i+1];}
const id=options['--id'],extension=options['--extension']??'txt';if(!id||id.length>96||! /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)||id==='example.csv'||id==='omniflow'||id.startsWith('omniflow.'))throw new Error('请使用自己的合法插件 ID');if(! /^[a-z0-9]{1,32}$/.test(extension))throw new Error('扩展名无效');if(!options['--out'])throw new Error('缺少 --out');
const kit=path.dirname(fileURLToPath(import.meta.url)),target=path.resolve(options['--out']);if(target===kit||target.startsWith(kit+path.sep))throw new Error('工程必须位于开发包目录之外');
let created=false;try{await mkdir(target);created=true;await cp(path.join(kit,'template'),target,{recursive:true});await mkdir(path.join(target,'vendor'));await copyFile(path.join(kit,'sdk/omniflow-plugin-sdk-0.4.0.tgz'),path.join(target,'vendor/omniflow-plugin-sdk-0.4.0.tgz'));
 const manifest=JSON.parse(await readFile(path.join(target,'manifest.json'),'utf8'));manifest.id=id;manifest.viewers[0].id=id+'.main';manifest.viewers[0].extensions=[extension];manifest.activation=['viewer:'+id+'.main'];await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const pkg=JSON.parse(await readFile(path.join(target,'package.json'),'utf8'));pkg.name=id.replaceAll('.','-');pkg.dependencies['@omniflow/plugin-sdk']='file:vendor/omniflow-plugin-sdk-0.4.0.tgz';await writeFile(path.join(target,'package.json'),JSON.stringify(pkg,null,2)+'\n');console.log(JSON.stringify({project:target,id,next:['npm install --offline --ignore-scripts --no-audit --no-fund','npm run build','npm run package']}));
}catch(error){if(created)await rm(target,{recursive:true,force:true});throw error;}
