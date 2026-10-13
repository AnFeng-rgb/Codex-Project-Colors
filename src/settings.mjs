import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultApplication } from '../demo/platforms/macos/launch.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function settings(args = process.argv.slice(2)) {
  const argument = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const dataDir = path.resolve(argument('--data-dir') ?? process.env.COLOR_LABELS_DATA_DIR ?? path.join(projectRoot, 'data'));
  await fs.mkdir(dataDir, { recursive: true });
  const config = await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return {}; throw new Error('运行设置无法读取，请检查 settings.json'); });
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('运行设置格式无效，原文件已保留');
  const port = config.port ?? Number(process.env.COLOR_LABELS_PORT ?? 39222);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('调试端口须为 1024–65535 的整数');
  return { dataDir, runtime: path.join(dataDir, 'runtime'), port, appPath: config.appPath ?? process.env.COLOR_LABELS_APP ?? defaultApplication,
    targetURL: config.targetURL ?? 'app://-/index.html', windowURL: config.windowURL ?? process.env.COLOR_LABELS_WINDOW_URL,
    legacyRuntime: argument('--legacy-runtime') ?? path.join(projectRoot, 'demo/runtime') };
}
