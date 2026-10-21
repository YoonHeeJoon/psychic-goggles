import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`          -> dist/ (multi-file, for any static host)
// `npm run build:single`   -> dist-single/index.html (one self-contained file)
// `npm run build:artifact` -> dist-artifact/ (single file, three.js loaded from jsDelivr)
export default defineConfig(({ mode }) => {
  const single = mode === 'single' || mode === 'artifact';
  const artifact = mode === 'artifact';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: artifact ? 'dist-artifact' : mode === 'single' ? 'dist-single' : 'dist',
      target: 'es2020',
      minify: artifact ? false : 'esbuild',
      chunkSizeWarningLimit: 2000,
      rollupOptions: artifact ? { external: ['three', /^three\/addons\//] } : {},
    },
    server: { host: true },
  };
});
