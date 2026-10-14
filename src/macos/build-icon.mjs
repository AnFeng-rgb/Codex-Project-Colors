import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function buildIcon(root, resources) {
  const source = path.join(root, 'assets/app-icon/AppIcon.png');
  const iconset = path.join(root, 'release/AppIcon.iconset');
  await fs.mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      await exec('/usr/bin/sips', ['-z', String(pixels), String(pixels), source, '--out', path.join(iconset, name)]);
    }
  }
  await exec('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'AppIcon.icns')]);
}
