#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · build (optional — the app runs unbuilt as native ES modules)
//
//   npm run build            → dist/  one minified bundle; `npm start` serves it
//   npm run build -- --standalone
//                            → dist/daod-standalone.html: the whole client in a
//                              single file (demo lessons play with no server)
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web'), DIST = path.join(ROOT, 'dist');
const standalone = process.argv.includes('--standalone');

let esbuild;
try { esbuild = await import('esbuild'); } catch {
  console.error('esbuild is not installed. Run `npm install` first (it is a dev dependency).');
  process.exit(1);
}

if (!standalone) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });

// One bundle; the demo lessons are pulled in lazily only if the server is missing.
const js = await esbuild.build({
  entryPoints: [path.join(WEB, 'js/main.js')],
  bundle: true, minify: true, format: 'esm', target: ['es2022', 'safari16'],
  write: false, legalComments: 'none', charset: 'utf8',
});
const css = await esbuild.transform(fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8'), { loader: 'css', minify: true });
const jsCode = js.outputFiles[0].text;

let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
  .replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
  .replace(/\s*<!-- Start loading every module[^>]*-->/, '');

if (standalone) {
  const logo = `data:image/svg+xml;base64,${fs.readFileSync(path.join(WEB, 'assets/logo.svg')).toString('base64')}`;
  html = html
    .replace(/\/assets\/logo\.svg/g, logo)
    .replace('<link rel="stylesheet" href="/styles.css">', `<style>${css.code}</style>`)
    .replace('<script type="module" src="/js/main.js"></script>', `<script type="module">${jsCode.replace(/<\/script/g, '<\\/script')}</script>`);
  fs.writeFileSync(path.join(DIST, 'daod-standalone.html'), html);
  report('daod-standalone.html', html);
} else {
  fs.writeFileSync(path.join(DIST, 'js/main.js'), jsCode);
  fs.writeFileSync(path.join(DIST, 'styles.css'), css.code);
  fs.cpSync(path.join(WEB, 'assets'), path.join(DIST, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'index.html'), html.replace('<script type="module"', '<link rel="modulepreload" href="/js/main.js">\n  <script type="module"'));
  report('js/main.js', jsCode);
  report('styles.css', css.code);
}

function report(name, text) {
  const gz = zlib.gzipSync(text, { level: 9 }).length;
  console.log(`  ${name.padEnd(22)} ${(text.length / 1024).toFixed(1).padStart(6)} KB   ${(gz / 1024).toFixed(1).padStart(5)} KB gzipped`);
}
