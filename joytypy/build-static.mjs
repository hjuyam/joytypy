// 只发布浏览器运行需要的文件；Node 服务、测试和本地工具不进入公开站点。
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
const files = [
  'index.html', 'style.css', 'app.js', 'practice.js', 'pinyin-engine.js',
  'keyboard.js', 'report.js', 'accounting.js', 'portable-data.js',
  'service-worker.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/pinyin-pro.js', 'lessons/catalog.json',
];

await rm(output, { recursive: true, force: true });
for (const file of files) {
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, file), destination);
}
for (const name of await readdir(path.join(root, 'lessons'))) {
  if (!/^[一-龥a-zA-Z0-9_.\-]+\.(txt|md)$/i.test(name)) continue;
  await cp(path.join(root, 'lessons', name), path.join(output, 'lessons', name));
}
console.log(`静态站点已生成：${output}`);
