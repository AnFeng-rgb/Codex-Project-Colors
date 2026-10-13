import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function parseCommand(raw, token, previousId) {
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || value.token !== token || !Number.isSafeInteger(value.id) || value.id <= previousId ||
      value.action !== 'open-preferences' || Object.keys(value).some(key => !['token', 'id', 'action'].includes(key))) return null;
  return value;
}

export async function revealPreferences(dataDir) {
  const file = path.join(dataDir, 'preferences.json');
  await fs.access(file);
  if (process.platform !== 'darwin') throw new Error('打开配色文件尚未适配当前平台');
  // Reveal the actual configuration in Finder; never execute a page-supplied path.
  await exec('/usr/bin/open', ['-R', file]);
}
