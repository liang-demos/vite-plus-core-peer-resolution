import json
import os
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
results = []
metadata_files = {'.package-lock.json', '.modules.yaml', '.pnpm-workspace-state-v1.json', 'lock.yaml'}
for name in ['npm-before', 'npm-after', 'pnpm-before', 'pnpm-after']:
    project = root / name
    if not (project / 'node_modules').exists():
        raise RuntimeError(f'Missing install: {project}')
    resolution = json.loads(subprocess.check_output([
        'node', str(pathlib.Path(__file__).with_name('inspect.mjs')), str(project),
    ]))
    expected_core = '8.3.7000' if name.endswith('after') else '1.6.0'
    if resolution['cliVite']['version'] != expected_core:
        raise RuntimeError(f'{name}: expected core {expected_core}, got {resolution["cliVite"]["version"]}; check package-manager caches/config')
    (project / 'resolution.json').write_text(json.dumps(resolution, indent=2) + '\n')
    total = 0
    payload = 0
    upstream = []
    packages = []
    # Do not follow symlinks: pnpm's links point back into its virtual store.
    for base, directories, files in os.walk(project / 'node_modules'):
        for filename in files:
            path = pathlib.Path(base) / filename
            if not path.is_symlink():
                total += path.stat().st_size
                if filename not in metadata_files:
                    payload += path.stat().st_size
            is_package_root = (path.parent.parent.name == 'node_modules' or
                               path.parent.parent.parent.name == 'node_modules')
            if filename == 'package.json' and is_package_root:
                manifest = json.loads(path.read_text())
                if manifest.get('name'):
                    packages.append((manifest['name'], manifest.get('version')))
                if manifest.get('name') == 'vite':
                    upstream.append(str(path.relative_to(project)))
    results.append({
        'case': name,
        'bytes': total,
        'payloadBytes': payload,
        'MiB': total / 1048576,
        'upstream': upstream,
        'sameVite': resolution['sameVite'],
        'core': resolution['cliVite']['version'],
        'vitestViteName': resolution['vitestVite']['name'],
        'vitestViteVersion': resolution['vitestVite']['version'],
        'packages': len(packages),
    })
    (project / 'packages.json').write_text(json.dumps(sorted(packages), indent=2) + '\n')
print(json.dumps(results, indent=2))
(root / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
