// Turns dist-artifact/index.html into a body-only page for publishing as an
// artifact: three.js comes from jsDelivr through an import map, everything
// else (our code + CSS) is inline.
import fs from 'node:fs';

const THREE_VERSION = '0.170.0';
const out = process.argv[2] || 'dist-artifact/starwind.html';
const html = fs.readFileSync('dist-artifact/index.html', 'utf8');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
if (!scripts) throw new Error('no module script found');
if (scripts.includes('</script')) throw new Error('script contains a closing tag');

const importMap = {
  imports: {
    three: `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`,
    'three/addons/': `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/`,
  },
};

const page = [
  '<title>Starwind 별바람 군도</title>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@500;600&display=swap" rel="stylesheet">',
  `<script type="importmap">${JSON.stringify(importMap)}</script>`,
  `<style>:root{color-scheme:dark}\n${styles}</style>`,
  '<div id="app"></div>',
  `<script type="module">\n${scripts}\n</script>`,
  '',
].join('\n');
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
