import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const out = path.join(root, 'www');
const staticEntries = [
  'index.html', 'login.html', 'app.html', 'offline.html',
  'manifest.json', 'service-worker.js', 'css', 'assets'
];

if (existsSync(out)) await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'js'), { recursive: true });

for (const entry of staticEntries) {
  const source = path.join(root, entry);
  if (!existsSync(source)) continue;
  await cp(source, path.join(out, entry), { recursive: true });
}

await build({
  entryPoints: [path.join(root, 'js/app.js')],
  outfile: path.join(out, 'js/app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info'
});

const firebaseConfig = path.join(root, 'js/firebase-config.js');
if (existsSync(firebaseConfig)) {
  await cp(firebaseConfig, path.join(out, 'js/firebase-config.js'));
}

console.log('Build web concluído em ./www');
