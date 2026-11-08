// 本番の Firestore に対して、デプロイ済みの Security Rules が実際に効くかを測る。
// エミュレータのテスト（test/rules.test.mjs）とは別物で、こちらは本番を触る。
// 終わったら検証で作ったトラックと匿名アカウントを自分で片付ける。
//
//   npm run config && npm run test:e2e
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore, doc, setDoc, updateDoc, deleteDoc, getDoc, collection, getDocs,
  query, limit, orderBy, where, serverTimestamp, writeBatch, Timestamp
} from 'firebase/firestore';

const CONFIG = JSON.parse(readFileSync(new URL('../.firebase-config.json', import.meta.url), 'utf8'));

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const TRACK = `e2e-${stamp}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function actor(name) {
  const app = initializeApp(CONFIG, name);
  const { user } = await signInAnonymously(getAuth(app));
  return { uid: user.uid, db: getFirestore(app), name };
}
function anonApp(name) {
  const app = initializeApp(CONFIG, name);
  return { db: getFirestore(app) };
}

let pass = 0, fail = 0;
const rows = [];
async function ok(label, fn) {   // 通るべきもの
  try { await fn(); pass++; rows.push(['ok  ', label, '']); }
  catch (e) { fail++; rows.push([' NG ', label, `通るべきが落ちた: ${e.code || e.message}`]); }
}
async function denied(label, fn) {  // 落ちるべきもの
  try { await fn(); fail++; rows.push([' NG ', label, '落ちるべきが通った']); }
  catch (e) {
    const c = e.code || '';
    if (/permission-denied|PERMISSION_DENIED/.test(c + e.message)) { pass++; rows.push(['ok  ', label, '']); }
    else { fail++; rows.push([' NG ', label, `別の理由で落ちた: ${c} ${e.message}`.slice(0, 120)]); }
  }
}

const speaker  = await actor('speaker');
const poster   = await actor('poster');
const attacker = await actor('attacker');
const outsider = anonApp('outsider');   // 未認証
console.log(`speaker=${speaker.uid.slice(0,8)} poster=${poster.uid.slice(0,8)} attacker=${attacker.uid.slice(0,8)}\n`);

const tPath = `tracks/${TRACK}`;
function post(a, text) {
  const b = writeBatch(a.db);
  b.set(doc(collection(a.db, `${tPath}/comments`)), { text, createdAt: serverTimestamp() });
  b.set(doc(a.db, `${tPath}/posters/${a.uid}`), { lastPostAt: serverTimestamp() });
  return b.commit();
}

// --- トラック作成 -------------------------------------------------------
await ok('登壇者がトラックを作れる', () => setDoc(doc(speaker.db, tPath), {
  name: 'E2E Track', title: '', speaker: '', stopped: false,
  sessionStartedAt: serverTimestamp(), ownerUid: speaker.uid, createdAt: serverTimestamp(),
}));
await denied('未認証はトラックを読めない', () => getDoc(doc(outsider.db, tPath)));
await denied('未認証は投稿できない', () => setDoc(doc(collection(outsider.db, `${tPath}/comments`)), { text: 'x', createdAt: serverTimestamp() }));

// --- 制御面 -------------------------------------------------------------
await denied('他人は stopped を書けない', () => updateDoc(doc(attacker.db, tPath), { stopped: true }));
await denied('他人は sessionStartedAt を書けない', () => updateDoc(doc(attacker.db, tPath), { sessionStartedAt: serverTimestamp() }));
await denied('owner でも ownerUid は奪えない', () => updateDoc(doc(speaker.db, tPath), { ownerUid: attacker.uid }));
await ok('owner は title を更新できる', () => updateDoc(doc(speaker.db, tPath), { title: '本番E2E' }));

// --- 投稿とレート制限 ---------------------------------------------------
await ok('1投稿目は通る', () => post(poster, 'こんにちは'));
await denied('2秒以内の連投は落ちる', () => post(poster, 'れんだ'));
await ok('2.3秒待てば通る', async () => { await sleep(2300); return post(poster, 'わこつ'); });
await denied('posters を伴わない単発投稿は落ちる',
  () => setDoc(doc(collection(poster.db, `${tPath}/comments`)), { text: 'solo', createdAt: serverTimestamp() }));
await denied('61文字は落ちる', () => post(attacker, 'あ'.repeat(61)));
await denied('createdAt の偽装は落ちる', () => {
  const b = writeBatch(attacker.db);
  b.set(doc(collection(attacker.db, `${tPath}/comments`)), { text: 'fake', createdAt: Timestamp.fromMillis(0) });
  b.set(doc(attacker.db, `${tPath}/posters/${attacker.uid}`), { lastPostAt: serverTimestamp() });
  return b.commit();
});
await denied('他人の posters は更新できない',
  () => setDoc(doc(attacker.db, `${tPath}/posters/${poster.uid}`), { lastPostAt: serverTimestamp() }));

// --- 購読（本番で使う実クエリ）------------------------------------------
const snap = await getDoc(doc(speaker.db, tPath));
const startedAt = snap.data().sessionStartedAt;
await ok('本番クエリ（session境界 + desc + limit50）が通る', async () => {
  const q = query(collection(speaker.db, `${tPath}/comments`),
    where('createdAt', '>=', startedAt), orderBy('createdAt', 'desc'), limit(50));
  const r = await getDocs(q);
  if (r.size !== 2) throw new Error(`期待2件、実際${r.size}件`);
});
await denied('limit 51 は落ちる', () => getDocs(query(collection(speaker.db, `${tPath}/comments`), limit(51))));
await denied('limit 無しの全件取得は落ちる', () => getDocs(collection(speaker.db, `${tPath}/comments`)));
await denied('コメントは書き換えられない', async () => {
  const r = await getDocs(query(collection(speaker.db, `${tPath}/comments`), limit(1)));
  return updateDoc(r.docs[0].ref, { text: 'hacked' });
});

// --- 引き継ぎ -----------------------------------------------------------
await ok('owner は引き継ぎコードを置ける', () => setDoc(doc(speaker.db, `${tPath}/private/handoff`), { code: 'E2E-CODE-9' }));
await denied('owner 自身も読めない', () => getDoc(doc(speaker.db, `${tPath}/private/handoff`)));
await denied('他人は読めない', () => getDoc(doc(attacker.db, `${tPath}/private/handoff`)));
await denied('誤コードでは運用者になれない', () => setDoc(doc(attacker.db, `${tPath}/operators/${attacker.uid}`), { code: 'WRONG' }));
await ok('正コードで運用者になれる', () => setDoc(doc(poster.db, `${tPath}/operators/${poster.uid}`), { code: 'E2E-CODE-9' }));
await ok('運用者は sessionStartedAt を更新できる', () => updateDoc(doc(poster.db, tPath), { sessionStartedAt: serverTimestamp() }));

// --- 停止 ---------------------------------------------------------------
await ok('owner は停止できる', () => updateDoc(doc(speaker.db, tPath), { stopped: true }));
await denied('停止後は投稿できない', async () => { await sleep(2300); return post(attacker, 'late'); });
await ok('停止後も履歴は読める', () => getDocs(query(collection(speaker.db, `${tPath}/comments`), limit(50))));


// --- 後片付け -----------------------------------------------------------
function cleanup() {
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    execFileSync('firebase',
      ['firestore:delete', '--recursive', tPath, '--force', '--project', CONFIG.projectId], opts);
    console.log(`\n片付け: ${tPath} を削除した`);
  } catch (e) { console.log(`\n片付け失敗（手で消す）: ${tPath}`); }

  // 検証で作った匿名アカウントも消す
  try {
    const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], opts).trim();
    const uids = [speaker.uid, poster.uid, attacker.uid];
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${CONFIG.projectId}/accounts:batchDelete`;
    execFileSync('curl', ['-s', '-X', 'POST', url,
      '-H', `Authorization: Bearer ${token}`,
      '-H', `x-goog-user-project: ${CONFIG.projectId}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ localIds: uids, force: true })], opts);
    console.log(`片付け: 匿名アカウント ${uids.length} 件を削除した`);
  } catch (e) { console.log('片付け失敗: 匿名アカウントが残った'); }
}

const w = Math.max(...rows.map(r => [...r[1]].length));
for (const [st, label, msg] of rows) console.log(`  ${st} ${label}${msg ? '\n         -> ' + msg : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);

cleanup();
process.exit(fail ? 1 : 0);
