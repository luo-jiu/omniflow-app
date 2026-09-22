import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const files=[];let total=0;
async function scan(directory,prefix=''){if(prefix.split('/').length>9)throw new Error('目录层级超限');for(const name of (await readdir(directory)).sort()){const relative=prefix+name;const stat=await lstat(path.join(directory,name));if(stat.isSymbolicLink()||! /^[A-Za-z0-9_./-]+$/.test(relative))throw new Error('包路径无效');if(stat.isDirectory())await scan(path.join(directory,name),relative+'/');else if(stat.isFile()){if(files.length>=64||stat.size>1048576||(total+=stat.size)>4194304)throw new Error('包文件超限');files.push({name:relative,bytes:await readFile(path.join(directory,name))});}else throw new Error('只支持普通文件');}}
await scan('dist');if(files.length>64||files.some(file=>file.bytes.length>1048576))throw new Error('包文件超限');
const table=Uint32Array.from({length:256},(_,n)=>{let crc=n;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);return crc>>>0;});
const local=[],central=[];let offset=0;
for(const file of files){const name=Buffer.from(file.name);let crc=0xffffffff;for(const byte of file.bytes)crc=table[(crc^byte)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
 const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(file.bytes.length,18);header.writeUInt32LE(file.bytes.length,22);header.writeUInt16LE(name.length,26);
 const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(0x0314,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(file.bytes.length,20);record.writeUInt32LE(file.bytes.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE((0o100644<<16)>>>0,38);record.writeUInt32LE(offset,42);
 local.push(header,name,file.bytes);central.push(record,name);offset+=header.length+name.length+file.bytes.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...local,directory,end]);if(zip.length>4194304)throw new Error('ZIP 超过 4 MiB');await writeFile('plugin.zip',zip);console.log('已生成 plugin.zip（静态产物，无安装脚本）');
