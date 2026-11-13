import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const root = process.argv[2];
const manifests = new Map();
const archives = new Map();
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
  if (archives.has(path)) {
    response.end(archives.get(path));
    return;
  }
  const manifest = manifests.get(path);
  if (manifest) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      name: manifest.name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: manifest },
    }));
    return;
  }
  response.writeHead(302, { Location: `https://registry.npmjs.org/${path.slice(path.indexOf('/') + 1)}` });
  response.end();
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const port = server.address().port;

try {
  // Keep package payloads identical; only the core version and CLI alias change.
  for (const [name, short] of [['vite-plus', 'cli'], ['@voidzero-dev/vite-plus-core', 'core']]) {
    const metadataResponse = await fetch(`https://registry.npmjs.org/${name}/1.6.0`, { signal: AbortSignal.timeout(180_000) });
    if (!metadataResponse.ok) throw new Error(`Metadata request failed: ${metadataResponse.status}`);
    const metadata = await metadataResponse.json();
    const archiveResponse = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(180_000) });
    if (!archiveResponse.ok) throw new Error(`Tarball request failed: ${archiveResponse.status}`);
    const original = join(root, `original-${short}.tgz`);
    writeFileSync(original, Buffer.from(await archiveResponse.arrayBuffer()));
    for (const variant of ['before', 'after']) {
      const manifest = structuredClone(metadata);
      const directory = join(root, `${variant}-${short}`);
      mkdirSync(directory);
      execFileSync('tar', ['-xzf', original, '-C', directory]);
      const packagePath = join(directory, 'package/package.json');
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (variant === 'after') {
        if (short === 'core') {
          pkg.version = manifest.version = '8.3.7000';
        } else {
          pkg.dependencies.vite = manifest.dependencies.vite = 'npm:@voidzero-dev/vite-plus-core@8.3.7000';
        }
      }
      writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
      const filename = `${variant}-${short}.tgz`;
      execFileSync('tar', ['-czf', join(root, filename), '-C', directory, 'package'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      });
      const archive = readFileSync(join(root, filename));
      archives.set(filename, archive);
      manifest.dist = {
        tarball: `http://127.0.0.1:${port}/${filename}`,
        shasum: createHash('sha1').update(archive).digest('hex'),
      };
      manifests.set(`${variant}/${name}`, manifest);
      writeFileSync(join(root, `${variant}-${short}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  process.send({ port });
} catch (error) {
  server.close();
  throw error;
}
