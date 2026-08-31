#!/usr/bin/env node
// Set the plugin version everywhere from one argument.
// Usage: node scripts/version-bump.mjs <X.Y.Z>   (optional letter suffix, e.g. 1.1.9a)
// Writes package.json (the single source of truth), runs sync-version.mjs
// (manifest.json, mcpb/manifest.json, src/version.ts), then adds the
// versions.json entry from the synced manifest's minAppVersion.

import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const targetVersion = process.argv[2];

if (!targetVersion || !/^\d+\.\d+\.\d+[a-z]?$/.test(targetVersion)) {
  console.error("❌ Invalid or missing version. Usage: node scripts/version-bump.mjs <X.Y.Z>   (optional letter suffix, e.g. 1.1.9a)");
  process.exit(1);
}

try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  if (pkg.version !== targetVersion) {
    pkg.version = targetVersion;
    writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  }
  execFileSync(process.execPath, ['scripts/sync-version.mjs'], { stdio: 'inherit' });

  // versions.json maps each release to its minAppVersion. Read it from the
  // freshly synced manifest so the entry matches what ships.
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8'));
  const versions = JSON.parse(readFileSync('versions.json', 'utf-8'));
  versions[targetVersion] = manifest.minAppVersion;
  writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');

  console.log(`✅ Version set to ${targetVersion} (minAppVersion ${manifest.minAppVersion}).`);
} catch (error) {
  console.error('❌ Failed to set version:', error.message);
  process.exit(1);
}
