import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2]);
const managers = process.argv.slice(3);
if (!managers.length) managers.push('npm', 'pnpm', 'bun', 'yarn');
const results = [];
const metadataFiles = new Set(['.package-lock.json', '.modules.yaml', '.pnpm-workspace-state-v1.json', 'lock.yaml']);
for (const name of managers.flatMap((pm) => [pm + '-before', pm + '-after'])) {
  const project = join(root, name);
  const resolution = JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, 'inspect.mjs'), project]));
  const expectedCore = name.endsWith('after') ? '8.3.7000' : '1.6.0';
  if (resolution.cliVite.version !== expectedCore) {
    throw new Error(`${name}: expected core ${expectedCore}, got ${resolution.cliVite.version}; check package-manager caches/config`);
  }
  writeFileSync(join(project, 'resolution.json'), `${JSON.stringify(resolution, null, 2)}\n`);
  let total = 0;
  let payload = 0;
  const upstream = [];
  const packages = [];
  const directories = [join(project, 'node_modules')];
  // Do not follow symlinks: pnpm's links point back into its virtual store.
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) directories.push(path);
      if (!entry.isFile()) continue;
      const size = statSync(path).size;
      total += size;
      if (!metadataFiles.has(entry.name)) payload += size;
      const isPackageRoot = basename(dirname(directory)) === 'node_modules'
        || basename(dirname(dirname(directory))) === 'node_modules';
      if (entry.name === 'package.json' && isPackageRoot) {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        if (manifest.name) packages.push([manifest.name, manifest.version]);
        if (manifest.name === 'vite') upstream.push(relative(project, path));
      }
    }
  }
  results.push({
    case: name, bytes: total, payloadBytes: payload, MiB: total / 1048576,
    upstream, sameVite: resolution.sameVite, core: resolution.cliVite.version,
    vitestViteName: resolution.vitestVite.name, vitestViteVersion: resolution.vitestVite.version,
    packages: packages.length,
  });
  writeFileSync(join(project, 'packages.json'), `${JSON.stringify(packages.sort(), null, 2)}\n`);
}
console.log(JSON.stringify(results, null, 2));
writeFileSync(join(root, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
