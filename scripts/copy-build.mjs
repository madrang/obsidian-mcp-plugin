#!/usr/bin/env node
// Fresh production build, then copy the three release files (main.js,
// manifest.json, styles.css) into a target folder — typically a vault's
// .obsidian/plugins/<plugin-id>/ directory for manual testing.
//
// Usage: node scripts/copy-build.mjs <destination-folder>
//
// The destination is created when missing. The script exits non-zero when
// no destination is given, the build fails, or any artifact is missing —
// a failed run never leaves a half-copied plugin folder behind.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: node scripts/copy-build.mjs <destination-folder>');
  process.exit(1);
}

console.log(`Building a fresh bundle in ${root} ...`);
const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('Build failed. Nothing was copied.');
  process.exit(build.status ?? 1);
}

const missing = ARTIFACTS.filter(file => !existsSync(join(root, file)));
if (missing.length > 0) {
  console.error(`Build finished but these artifacts are missing: ${missing.join(', ')}`);
  process.exit(1);
}

const target = resolve(process.cwd(), destination);
mkdirSync(target, { recursive: true });
for (const file of ARTIFACTS) {
  copyFileSync(join(root, file), join(target, file));
  console.log(`Copied ${file} -> ${join(target, file)}`);
}
console.log(`Deployed ${ARTIFACTS.length} files to ${target}`);
