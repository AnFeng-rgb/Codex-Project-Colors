import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
export const defaultApplication = '/Applications/ChatGPT.app';

export async function ensureApplication(appPath, port, { entryLabel = '“启动Demo.command”', configurationHint = 'demo/runtime/options.json' } = {}) {
  if (process.platform !== 'darwin') throw new Error('此启动入口仅适配 macOS，Windows 尚未验证');
  appPath = await fs.realpath(appPath).catch(() => { throw new Error('未找到指定的应用目录'); });
  const info = path.join(appPath, 'Contents/Info.plist');
  await fs.access(info).catch(() => { throw new Error(`未找到应用，请在 ${configurationHint} 中指定应用目录 appPath`); });
  const { stdout: name } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleExecutable', info]);
  const executable = path.join(appPath, 'Contents/MacOS', name.trim());
  const { stdout: processes } = await exec('/bin/ps', ['-axo', 'comm=']);
  if (processes.split('\n').some(line => line.trim() === executable)) {
    throw new Error(`应用已运行，但未找到本机调试主窗口。请先保存工作，用 ⌘Q 完全退出应用，再使用 ${entryLabel} 开启。工具不会替你退出或重开工作窗口。`);
  }
  await exec('/usr/bin/open', ['-a', appPath, '--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]);
}
