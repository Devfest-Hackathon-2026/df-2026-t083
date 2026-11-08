// Firebase の Web 設定を CLI から取り出してファイルに落とす。
// 設定値は Hosting から公開されるものだが、リポジトリには置かない方針なので生成物にする。
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const projectId = JSON.parse(readFileSync('.firebaserc', 'utf8')).projects.default;
const raw = execFileSync('firebase', ['apps:sdkconfig', 'WEB', '--json', '--project', projectId],
  { encoding: 'utf8', maxBuffer: 1 << 24 });

const parsed = JSON.parse(raw);
const c = parsed.result?.sdkConfig ?? parsed.result ?? parsed;
const keep = ['apiKey', 'authDomain', 'projectId', 'appId', 'storageBucket', 'messagingSenderId'];
const config = Object.fromEntries(keep.filter(k => c[k]).map(k => [k, c[k]]));

if (!config.apiKey || !config.projectId) {
  console.error('設定が取れなかった:', raw.slice(0, 400));
  process.exit(1);
}

writeFileSync('.firebase-config.json', JSON.stringify(config, null, 2) + '\n');
writeFileSync('public/firebase-config.js',
  `// 生成物。編集しない。\`npm run config\` で作り直す。\nexport const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`);

console.log(`✓ ${config.projectId} の設定を書き出した`);
console.log('  .firebase-config.json      (テスト用)');
console.log('  public/firebase-config.js  (配信用)');
