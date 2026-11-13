import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';

const managers = process.argv.slice(2);
if (!managers.length) managers.push('npm', 'pnpm', 'bun', 'yarn');
if (new Set(managers).size !== managers.length || managers.some((pm) => !['npm', 'pnpm', 'bun', 'yarn'].includes(pm))) {
  throw new Error('Usage: node run.mjs [npm pnpm bun yarn] (no duplicates)');
}
const root = import.meta.dirname;
mkdirSync(join(root, '.runs'), { recursive: true });
const run = mkdtempSync(join(root, '.runs/compare-'));
console.log(`Artifacts: ${run}`);
for (const name of ['user.npmrc', 'global.npmrc']) writeFileSync(join(run, name), '');

// A separate registry process keeps serving requests while package-manager commands run.
const registry = fork(join(root, 'scripts/registry.mjs'), [run]);
try {
  const { port } = await new Promise((resolve, reject) => {
    registry.once('message', resolve);
    registry.once('error', reject);
    registry.once('exit', (code) => reject(new Error(`Registry exited before startup (${code})`)));
  });
  const versions = { platform: `${platform()} ${release()} ${arch()}`, node: process.version };
  for (const pm of managers) {
    versions[pm] = execFileSync(pm, ['--version'], { cwd: run, encoding: 'utf8' }).trim();
    for (const variant of ['before', 'after']) {
      const project = join(run, `${pm}-${variant}`);
      mkdirSync(project);
      writeFileSync(join(project, 'package.json'), `${JSON.stringify({
        name: `probe-${pm}-${variant}`, private: true, dependencies: { 'vite-plus': '1.6.0' },
      }, null, 2)}\n`);
      const args = ['install', '--ignore-scripts', `--registry=http://127.0.0.1:${port}/${variant}/`];
      if (pm === 'npm') {
        args.push(`--cache=${run}/cache-${variant}`, '--no-audit', '--no-fund',
          `--userconfig=${run}/user.npmrc`, `--globalconfig=${run}/global.npmrc`);
      } else if (pm === 'pnpm') {
        writeFileSync(join(project, 'pnpm-workspace.yaml'), 'enableGlobalVirtualStore: false\nminimumReleaseAge: 0\n');
        args.push(`--store-dir=${run}/store-${variant}`, `--cache-dir=${run}/pnpm-cache-${variant}`,
          '--config.package-import-method=copy', '--config.manage-package-manager-versions=false');
      } else if (pm === 'bun') {
        args.push('--backend=copyfile', '--no-cache', '--cache-dir=' + join(run, 'bun-cache-' + variant));
      } else if (pm === 'yarn') {
        // Use node_modules for comparable file-size measurements, rather than Yarn's default PnP layout.
        writeFileSync(join(project, '.yarnrc.yml'), [
          'nodeLinker: node-modules', 'enableScripts: false', 'enableGlobalCache: false',
          'enableImmutableInstalls: false', 'unsafeHttpWhitelist: [127.0.0.1]',
          'npmMinimalAgeGate: 0',
          'npmRegistryServer: ' + JSON.stringify('http://127.0.0.1:' + port + '/' + variant + '/'),
          'cacheFolder: ' + JSON.stringify(join(run, 'yarn-cache-' + variant)),
          'globalFolder: ' + JSON.stringify(join(run, 'yarn-global-' + variant)),
        ].join('\n') + '\n');
        args.splice(0, args.length, 'install');
      }
      console.log(`Installing ${pm} ${variant}...`);
      const logPath = join(project, 'install.log');
      const log = openSync(logPath, 'w');
      try {
        execFileSync(pm, args, { cwd: project, stdio: ['ignore', log, log] });
      } catch (cause) {
        throw new Error(`Install failed; see ${logPath}`, { cause });
      } finally {
        closeSync(log);
      }
    }
  }
  writeFileSync(join(run, 'environment.json'), `${JSON.stringify(versions, null, 2)}\n`);
  execFileSync(process.execPath, [join(root, 'scripts/measure.mjs'), run, ...managers], { stdio: 'inherit' });
} finally {
  if (registry.exitCode === null && registry.signalCode === null) {
    const exited = once(registry, 'exit');
    registry.kill();
    await exited;
  }
}
