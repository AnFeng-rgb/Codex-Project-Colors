import path from 'node:path';import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const identity=process.env.COLOR_LABELS_SIGN_IDENTITY,profile=process.env.COLOR_LABELS_NOTARY_PROFILE;
if(!identity?.startsWith('Developer ID Application:')||!profile)throw Error('需要 Developer ID Application 证书名称和已保存的钥匙串公证配置；没有修改应用或上传文件');
const app=path.join(root,'release/颜色标签.app'),resources=path.join(app,'Contents/Resources');
const signedIdentities=(await exec('/usr/bin/security',['find-identity','-v','-p','codesigning'])).stdout;
if(!signedIdentities.includes(`"${identity}"`))throw Error('未找到指定开发者证书，没有修改应用或上传文件');
await exec('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--entitlements',path.join(root,'src/macos/node.entitlements.plist'),'--sign',identity,path.join(resources,'node')]);
await exec('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--sign',identity,path.join(resources,'startup-bridge')]);
await exec('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--sign',identity,app]);
await exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);
const upload=path.join(root,'release/notarization-upload.zip');
await exec('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',app,upload]);
// Run only after the owner authorizes Apple submission and supplies a stored profile.
const result=await exec('/usr/bin/xcrun',['notarytool','submit',upload,'--keychain-profile',profile,'--wait','--output-format','json'],{timeout:900000,maxBuffer:1000000});
const status=JSON.parse(result.stdout);await fs.writeFile(path.join(root,'release/notarization-result.json'),JSON.stringify(status,null,2)+'\n');
if(status.status!=='Accepted')throw Error('Apple 公证未通过，未生成可正式发布的结论');
await exec('/usr/bin/xcrun',['stapler','staple',app]);await exec('/usr/bin/xcrun',['stapler','validate',app]);await exec('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',app]);console.log('开发者签名、公证与系统验收通过；请重新生成分发包');
