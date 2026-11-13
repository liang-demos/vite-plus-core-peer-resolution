import json
import pathlib
import platform
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
(ROOT / '.runs').mkdir(exist_ok=True)
run = pathlib.Path(tempfile.mkdtemp(prefix='compare-', dir=ROOT / '.runs'))
print(f'Artifacts: {run}', flush=True)
for name in ['user.npmrc', 'global.npmrc']:
    (run / name).touch()

# A local registry preserves npm alias semantics; file: dependencies would test a different graph.
registry = subprocess.Popen(
    [sys.executable, str(ROOT / 'scripts/registry.py'), str(run)],
    stdout=subprocess.PIPE, text=True,
)
try:
    port = registry.stdout.readline().strip()
    if not port.isdigit():
        raise RuntimeError('Registry failed to start')
    versions = {'platform': platform.platform()}
    for pm in ['npm', 'pnpm']:
        versions[pm] = subprocess.check_output([pm, '--version'], cwd=run, text=True).strip()
        for variant in ['before', 'after']:
            case = run / f'{pm}-{variant}'
            case.mkdir()
            (case / 'package.json').write_text(json.dumps({
                'name': f'probe-{pm}-{variant}', 'private': True,
                'dependencies': {'vite-plus': '1.6.0'},
            }, indent=2) + '\n')
            command = [pm, 'install', '--ignore-scripts', f'--registry=http://127.0.0.1:{port}/{variant}/']
            if pm == 'npm':
                command += [f'--cache={run}/cache-{variant}', '--no-audit', '--no-fund',
                            f'--userconfig={run}/user.npmrc', f'--globalconfig={run}/global.npmrc']
            else:
                (case / 'pnpm-workspace.yaml').write_text('enableGlobalVirtualStore: false\nminimumReleaseAge: 0\n')
                command += [f'--store-dir={run}/store-{variant}', f'--cache-dir={run}/pnpm-cache-{variant}',
                            '--config.package-import-method=copy',
                            '--config.manage-package-manager-versions=false']
            print(f'Installing {pm} {variant}...', flush=True)
            with (case / 'install.log').open('w') as log:
                result = subprocess.run(command, cwd=case, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                raise RuntimeError(f'Install failed; see {case}/install.log')
    versions['node'] = subprocess.check_output(['node', '--version'], cwd=run, text=True).strip()
    (run / 'environment.json').write_text(json.dumps(versions, indent=2) + '\n')
    subprocess.run([sys.executable, str(ROOT / 'scripts/measure.py'), str(run)], check=True)
finally:
    registry.terminate()
    registry.wait()
