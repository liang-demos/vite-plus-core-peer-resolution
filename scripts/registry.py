import copy
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote

ROOT = pathlib.Path(sys.argv[1])
server = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
PORT = server.server_port
manifests = {}
# Keep every payload file identical; change only the version and alias manifests.
for name, short in [('vite-plus', 'cli'), ('@voidzero-dev/vite-plus-core', 'core')]:
    meta = json.loads(subprocess.check_output(['curl', '--retry', '3', '--max-time', '180', '-fsSL', f'https://registry.npmjs.org/{name}/1.6.0']))
    archive = subprocess.check_output(['curl', '--retry', '3', '--max-time', '180', '-fsSL', meta['dist']['tarball']])
    for variant in ['before', 'after']:
        manifest = copy.deepcopy(meta)
        if variant == 'after':
            if short == 'core':
                manifest['version'] = '8.3.7000'
            else:
                manifest['dependencies']['vite'] = 'npm:@voidzero-dev/vite-plus-core@8.3.7000'
        target = ROOT / f'{variant}-{short}.tgz'
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as src, tarfile.open(target, 'w:gz') as dst:
            for member in src:
                data = src.extractfile(member).read() if member.isfile() else None
                if member.name == 'package/package.json':
                    package = json.loads(data)
                    if variant == 'after':
                        if short == 'core':
                            package['version'] = '8.3.7000'
                        else:
                            package['dependencies']['vite'] = manifest['dependencies']['vite']
                    data = (json.dumps(package, indent=2) + '\n').encode()
                    member.size = len(data)
                dst.addfile(member, io.BytesIO(data) if data is not None else None)
        manifest['dist'] = {'tarball': f'http://127.0.0.1:{PORT}/{target.name}', 'shasum': hashlib.sha1(target.read_bytes()).hexdigest()}
        manifests[(variant, name)] = manifest
        (ROOT / f'{variant}-{short}.json').write_text(json.dumps(manifest, indent=2))

class Registry(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(self.path).split('?', 1)[0].lstrip('/')
        if path.endswith('.tgz') and '/' not in path:
            self.send_response(200)
            self.end_headers()
            self.wfile.write((ROOT / path).read_bytes())
            return
        variant, _, name = path.partition('/')
        manifest = manifests.get((variant, name))
        if manifest:
            body = json.dumps({'name': name, 'dist-tags': {'latest': manifest['version']}, 'versions': {manifest['version']: manifest}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(302)
            self.send_header('Location', 'https://registry.npmjs.org/' + name)
            self.end_headers()
    def log_message(self, *args):
        pass

server.RequestHandlerClass = Registry
print(PORT, flush=True)
server.serve_forever()
