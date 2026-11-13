import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
const rootRequire = createRequire(resolve(process.argv[2], 'package.json'));
const cliPath = rootRequire.resolve('vite-plus/package.json');
const cliRequire = createRequire(cliPath);
const vitestPath = cliRequire.resolve('vitest/package.json');
const vitestRequire = createRequire(vitestPath);
const cliVite = cliRequire.resolve('vite/package.json');
const vitestVite = vitestRequire.resolve('vite/package.json');
console.log(JSON.stringify({
  cli: JSON.parse(readFileSync(cliPath)).version,
  vitest: JSON.parse(readFileSync(vitestPath)).version,
  cliVite: { path: cliVite, ...JSON.parse(readFileSync(cliVite)) },
  vitestVite: { path: vitestVite, ...JSON.parse(readFileSync(vitestVite)) },
  sameVite: realpathSync(cliVite) === realpathSync(vitestVite),
}, null, 2));
