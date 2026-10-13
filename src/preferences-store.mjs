import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createPreferences } from '../demo/core/preferences.mjs';

const validate = createPreferences(null).validate;
const checksum = preferences => createHash('sha256').update(JSON.stringify(preferences)).digest('hex');
export function decodeRecord(raw) {
  if (raw.length > 400000) throw new Error('配色文件过大');
  const record = JSON.parse(raw);
  if (record.formatVersion !== 1) throw new Error('不支持的配色文件版本');
  const preferences = validate(record.preferences);
  if (record.checksum !== checksum(preferences)) throw new Error('配色文件校验失败，请恢复备份；原文件已保留');
  return preferences;
}
export async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
export class PreferenceStore {
  constructor(directory) { this.file = path.join(directory, 'preferences.json'); this.backup = path.join(directory, 'preferences.backup.json'); this.queue = Promise.resolve(); }
  async read(file = this.file) {
    try { return decodeRecord(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`无法读取配色：${e.message}`); }
  }
  write(value) {
    const preferences = validate(value);
    const next = this.queue.catch(() => {}).then(async () => {
      const previous = await fs.readFile(this.file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      // Never overwrite an unknown/corrupt primary file or backup it over a good backup.
      if (previous) { decodeRecord(previous); await atomicWrite(this.backup, previous); }
      const record = { formatVersion: 1, savedAt: new Date().toISOString(), preferences, checksum: checksum(preferences) };
      await atomicWrite(this.file, JSON.stringify(record, null, 2) + '\n');
      return preferences;
    });
    this.queue = next; return next;
  }
  async restoreBackup() {
    await this.queue.catch(() => {});
    const raw = await fs.readFile(this.backup, 'utf8'); decodeRecord(raw);
    const current = await fs.readFile(this.file, 'utf8').catch(() => null);
    if (current) await atomicWrite(`${this.file}.before-restore-${Date.now()}`, current);
    await atomicWrite(this.file, raw);
    return decodeRecord(raw);
  }
}
