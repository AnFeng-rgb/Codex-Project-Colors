import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.2.0';
const output = path.join(root, 'publishing/packages', `v${version}-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const sourceName = `CodexProjectColors-v${version}-source`;
const previewName = `CodexProjectColors-v${version}-macos-arm64`;
const source = path.join(output, sourceName), preview = path.join(output, previewName);
const copy = async (from, to) => { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to); };
const template = name => path.join(root, 'publishing/templates', name);
for (const file of ['README.md', 'INSTALL.md', 'REFERENCES.md']) {
  await copy(template(file), path.join(source, file));
  await copy(template(file), path.join(preview, file));
}
for (const folder of [source, preview]) await copy(path.join(root, 'LICENSE'), path.join(folder, 'LICENSE'));
for (const directory of ['src', 'demo/core']) {
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) await copy(path.join(root, directory, entry.name), path.join(source, directory, entry.name));
  }
}
for (const file of ['src/macos/Manager.m', 'src/macos/StartupBridge.m', 'src/macos/build.mjs', 'src/macos/fetch-runtime.mjs', 'src/macos/sign-release.mjs', 'src/macos/node.entitlements.plist', 'src/startup/controller.mjs', 'src/startup/watch.mjs', 'third-party/codex-usage-badge-LICENSE', 'demo/platforms/macos/launch.mjs']) await copy(path.join(root, file), path.join(source, file));
for (const file of ['sidebar-browser.mjs', 'wheel-browser.mjs', 'randomize-browser.mjs', 'first-use-browser.mjs']) await copy(path.join(root, 'verification/release', file), path.join(source, 'verification/release', file));
await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({
  name: 'codex-project-colors', version, private: true, type: 'module', license: 'MIT', engines: { node: '>=24' },
  scripts: { test: 'node --test src/*.test.mjs demo/core/*.test.mjs', 'build:macos': 'node src/macos/build.mjs' },
}, null, 2) + '\n');
await fs.writeFile(path.join(source, '.gitignore'), '.DS_Store\n/data/\n/release/\n/demo/runtime/\n/node_modules/\n/verification/release/*.json\n');

const app = path.join(root, 'release/颜色标签.app');
const { stdout: architecture } = await exec('/usr/bin/lipo', ['-archs', path.join(app, 'Contents/MacOS/ColorLabels')]);
if (architecture.trim() !== 'arm64') throw new Error('此预览包名称只适用于 arm64 程序');
const expectedAppFiles = new Set([
  'Contents/Info.plist', 'Contents/MacOS/ColorLabels', 'Contents/_CodeSignature/CodeResources',
  'Contents/Resources/node', 'Contents/Resources/startup-bridge', 'Contents/Resources/NODE-LICENSE', 'Contents/Resources/LICENSE', 'Contents/Resources/STARTUP-LICENSE',
  ...['agent.mjs', 'cli.mjs', 'settings.mjs', 'preferences-store.mjs', 'commands.mjs', 'browser-session.mjs', 'installation.mjs', 'first-use.mjs'].map(name => `Contents/Resources/tool/src/${name}`),
  ...['controller.mjs', 'watch.mjs'].map(name => `Contents/Resources/tool/src/startup/${name}`),
  ...['renderer.mjs', 'adapter.mjs', 'preferences.mjs', 'cdp.mjs', 'injector.mjs'].map(name => `Contents/Resources/tool/demo/core/${name}`),
  'Contents/Resources/tool/demo/platforms/macos/launch.mjs',
]);
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`导出拒绝符号链接：${relative}`);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}
const appFiles = await files(app);
if (appFiles.length !== expectedAppFiles.size || appFiles.some(file => !expectedAppFiles.has(file))) throw new Error('应用包包含清单外文件，请先审查后再导出');
for (const file of appFiles) await copy(path.join(app, file), path.join(preview, 'Codex Project Colors.app', file));
for(const file of ['Contents/MacOS/ColorLabels','Contents/Resources/node','Contents/Resources/startup-bridge'])await fs.chmod(path.join(preview,'Codex Project Colors.app',file),0o755);
await exec('/usr/bin/codesign',['--verify','--strict',path.join(preview,'Codex Project Colors.app')]);

const forbidden = /(?:\/Users\/|\/Volumes\/|github_pat_[A-Za-z0-9_]{15,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const manifests = {};
for (const [name, directory] of [[sourceName, source], [previewName, preview]]) {
  const inventory = [];
  for (const file of await files(directory)) {
    if (/(^|\/)(data|runtime|research|design)(\/|$)/.test(file)) throw new Error(`导出包含本机或研究数据：${file}`);
    const buffer = await fs.readFile(path.join(directory, file));
    if (/\.(?:mjs|m|md|json|plist)$/.test(file) && forbidden.test(buffer.toString('utf8'))) throw new Error(`导出文本检查未通过：${file}`);
    inventory.push({ file, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
  }
  manifests[name] = inventory;
  await exec('/usr/bin/ditto', ['--norsrc', '--noextattr', '-c', '-k', '--keepParent', directory, path.join(output, `${name}.zip`)]);
}
const checksums = [];
for (const name of [sourceName, previewName]) {
  const file = `${name}.zip`, data = await fs.readFile(path.join(output, file));
  checksums.push(`${createHash('sha256').update(data).digest('hex')}  ${file}`);
}
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version, architecture: 'arm64', personalDataIncluded: false, manifests }, null, 2) + '\n');
console.log(output);
