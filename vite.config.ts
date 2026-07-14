import { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { KAKAKE_PLUGIN_NAME } from './scripts/plugin-constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Vite 构建产物目录（与 package.json name 一致，便于直接部署） */
const OUT_DIR = 'napcat-plugin-mkbot';

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

function copyMkbotAssetsPlugin() {
  return {
    name: 'copy-mkbot-assets',
    writeBundle() {
      const outDir = resolve(__dirname, OUT_DIR);

      const webuiSrc = resolve(__dirname, 'webui');
      if (fs.existsSync(webuiSrc)) {
        copyDirRecursive(webuiSrc, resolve(outDir, 'webui'));
        console.log(`[copy-mkbot-assets] webui/ → ${OUT_DIR}/webui`);
      }

      const dataSrc = resolve(__dirname, 'data');
      if (fs.existsSync(dataSrc)) {
        copyDirRecursive(dataSrc, resolve(outDir, 'data'));
        console.log(`[copy-mkbot-assets] data/ → ${OUT_DIR}/data`);
      }

      const assetsSrc = resolve(__dirname, 'assets');
      if (fs.existsSync(assetsSrc)) {
        copyDirRecursive(assetsSrc, resolve(outDir, 'assets'));
        console.log(`[copy-mkbot-assets] assets/ → ${OUT_DIR}/assets（插件头像等静态资源）`);
      }

      const iconPath = resolve(outDir, 'assets', 'chajian.jpg');
      if (!fs.existsSync(iconPath)) {
        console.warn(
          `[copy-mkbot-assets] 未找到插件头像 assets/chajian.jpg，请在 MKbot13/assets/chajian.jpg 放置图片，并在 plugin.json 配置 "icon": "assets/chajian.jpg"`
        );
      } else {
        console.log(`[copy-mkbot-assets] 插件头像: ${OUT_DIR}/assets/chajian.jpg（plugin.json icon 指向此文件）`);
      }

      const pluginJson = resolve(__dirname, 'plugin.json');
      if (fs.existsSync(pluginJson)) {
        const manifest = JSON.parse(fs.readFileSync(pluginJson, 'utf-8')) as Record<string, unknown>;
        manifest.name = KAKAKE_PLUGIN_NAME;
        fs.writeFileSync(resolve(outDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`[copy-mkbot-assets] plugin.json → ${OUT_DIR}/plugin.json (name=${KAKAKE_PLUGIN_NAME})`);
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
        fs.writeFileSync(resolve(outDir, 'package.json'), JSON.stringify(distPkg, null, 2));
        console.log(`[copy-mkbot-assets] 已写入 ${OUT_DIR}/package.json`);
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
      external: [...nodeModules, 'sharp'],
      output: {
        inlineDynamicImports: true,
      },
    },
    outDir: OUT_DIR,
  },
  plugins: [nodeResolve(), copyMkbotAssetsPlugin()],
});
