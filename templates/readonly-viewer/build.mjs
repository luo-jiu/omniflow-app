import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await mkdir('dist',{recursive:true});
const source=await readFile('src/main.js','utf8');
if(!source.includes("from '@omniflow/plugin-sdk'"))throw new Error('缺少 SDK 导入');
await writeFile('dist/main.js',source.replace("from '@omniflow/plugin-sdk'","from './sdk.js'"));
await copyFile(fileURLToPath(import.meta.resolve('@omniflow/plugin-sdk')),'dist/sdk.js');
for(const name of ['index.html','style.css'])await copyFile('src/'+name,'dist/'+name);
await copyFile('manifest.json','dist/manifest.json');console.log('已构建独立只读查看器');
