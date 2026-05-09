import { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nodeModules = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
].flat();

function copyDirRecursive(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 将 MKbot 运行时需要的静态资源复制到 dist（与官方模板 copyAssets 思路一致，WebUI 为既有 HTML 而非 React 子工程）。
 */
function copyMkbotAssetsPlugin() {
  return {
    name: 'copy-mkbot-assets',
    writeBundle() {
      const distDir = resolve(__dirname, 'dist');

      const webuiSrc = resolve(__dirname, 'webui');
      if (fs.existsSync(webuiSrc)) {
        copyDirRecursive(webuiSrc, resolve(distDir, 'webui'));
        console.log('[copy-mkbot-assets] webui/ → dist/webui');
      }

      const dataSrc = resolve(__dirname, 'data');
      if (fs.existsSync(dataSrc)) {
        copyDirRecursive(dataSrc, resolve(distDir, 'data'));
        console.log('[copy-mkbot-assets] data/ → dist/data');
      }

      const pluginJson = resolve(__dirname, 'plugin.json');
      if (fs.existsSync(pluginJson)) {
        fs.copyFileSync(pluginJson, resolve(distDir, 'plugin.json'));
        console.log('[copy-mkbot-assets] plugin.json → dist/plugin.json');
      }

      const pkgPath = resolve(__dirname, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const distPkg: Record<string, unknown> = {
          name: pkg.name,
          plugin: pkg.plugin,
          version: pkg.version,
          type: pkg.type,
          main: pkg.main,
          description: pkg.description,
          author: pkg.author,
          license: pkg.license,
          homepage: pkg.homepage,
          webui: pkg.webui,
          dependencies: pkg.dependencies,
        };
        if (pkg.napcat) {
          distPkg.napcat = pkg.napcat;
        }
        fs.writeFileSync(resolve(distDir, 'package.json'), JSON.stringify(distPkg, null, 2));
        console.log('[copy-mkbot-assets] 已写入 dist/package.json');
      }
    },
  };
}

export default defineConfig({
  resolve: {
    conditions: ['node', 'default'],
  },
  build: {
    sourcemap: false,
    target: 'esnext',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      external: [...nodeModules],
      output: {
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
  },
  plugins: [nodeResolve(), copyMkbotAssetsPlugin()],
});
