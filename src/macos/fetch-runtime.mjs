import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const version='v24.21.0',arch=process.arch==='arm64'?'arm64':'x64',name=`node-${version}-darwin-${arch}`,archive=`${name}.tar.gz`;
const output=path.join(root,'release/runtime-cache');await fs.mkdir(output,{recursive:true});
const response=await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('无法读取 Node 官方校验清单');
const expected=(await response.text()).split('\n').find(line=>line.endsWith(`  ${archive}`))?.split(/\s+/)[0];if(!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Node 官方清单中没有目标版本');
const file=path.join(output,archive);let data=await fs.readFile(file).catch(()=>null);
if(!data||createHash('sha256').update(data).digest('hex')!==expected){const downloaded=await fetch(`https://nodejs.org/dist/${version}/${archive}`,{signal:AbortSignal.timeout(60000)});if(!downloaded.ok)throw Error('Node 运行环境下载失败');data=Buffer.from(await downloaded.arrayBuffer());if(createHash('sha256').update(data).digest('hex')!==expected)throw Error('Node 校验失败，未采用下载文件');await fs.writeFile(file,data);}
await promisify(execFile)('/usr/bin/tar',['-xzf',file,'-C',output]);
await fs.writeFile(path.join(output,'verified.json'),JSON.stringify({version,arch,archive,sha256:expected,source:`https://nodejs.org/dist/${version}/${archive}`},null,2)+'\n');console.log(path.join(output,name));
