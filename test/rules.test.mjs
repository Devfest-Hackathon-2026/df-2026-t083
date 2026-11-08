import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, updateDoc, deleteDoc, getDoc, collection, getDocs,
  query, limit, serverTimestamp, writeBatch, Timestamp
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'rules-lab',
  firestore: { host: '127.0.0.1', port: 8181, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; results.push(['PASS', name]); }
  catch (e) { fail++; results.push(['FAIL', name, String(e.message || e).slice(0, 140)]); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- seed ---------------------------------------------------------------
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'tracks/trackA'), {
    name: 'Track A', title: '', speaker: '', stopped: false,
    sessionStartedAt: Timestamp.now(), ownerUid: 'staff', createdAt: Timestamp.now(),
  });
  await setDoc(doc(db, 'tracks/trackA/private/handoff'), { code: 'SECRET-123' });
  await setDoc(doc(db, 'tracks/stoppedTrack'), {
    name: 'Done', title: '', speaker: '', stopped: true,
    sessionStartedAt: Timestamp.now(), ownerUid: 'staff', createdAt: Timestamp.now(),
  });
  await setDoc(doc(db, 'tracks/stoppedTrack/comments/c0'), { text: 'x', createdAt: Timestamp.now() });
  await setDoc(doc(db, 'tracks/trackA/comments/c1'), { text: 'hello', createdAt: Timestamp.now() });
});

const anon   = () => env.unauthenticatedContext().firestore();
const as     = (uid) => env.authenticatedContext(uid).firestore();

// 投稿は「コメント + posters」のバッチ。アプリ側もこの形で書く。
function post(db, trackId, uid, text) {
  const b = writeBatch(db);
  b.set(doc(collection(db, `tracks/${trackId}/comments`)), { text, createdAt: serverTimestamp() });
  b.set(doc(db, `tracks/${trackId}/posters/${uid}`), { lastPostAt: serverTimestamp() });
  return b.commit();
}

// --- T1: 未認証を落とす -------------------------------------------------
await t('T1 未認証はトラックを読めない', () => assertFails(getDoc(doc(anon(), 'tracks/trackA'))));
await t('T1 未認証はコメントを読めない', () => assertFails(getDocs(query(collection(anon(), 'tracks/trackA/comments'), limit(50)))));
await t('T1 未認証は投稿できない',       () => assertFails(post(anon(), 'trackA', 'nobody', 'hi')));

// --- T2: 制御面の乗っ取りを落とす ---------------------------------------
await t('T2 他人は stopped を書けない',        () => assertFails(updateDoc(doc(as('attacker'), 'tracks/trackA'), { stopped: true })));
await t('T2 他人は sessionStartedAt を書けない', () => assertFails(updateDoc(doc(as('attacker'), 'tracks/trackA'), { sessionStartedAt: serverTimestamp() })));
await t('T2 他人はトラックを消せない',          () => assertFails(deleteDoc(doc(as('attacker'), 'tracks/trackA'))));
await t('T2 owner は stopped を書ける',         () => assertSucceeds(updateDoc(doc(as('staff'), 'tracks/trackA'), { stopped: false })));
await t('T2 owner は sessionStartedAt を書ける', () => assertSucceeds(updateDoc(doc(as('staff'), 'tracks/trackA'), { sessionStartedAt: serverTimestamp() })));
await t('T2 owner でも ownerUid は奪えない',     () => assertFails(updateDoc(doc(as('staff'), 'tracks/trackA'), { ownerUid: 'someoneElse' })));
await t('T2 owner でも createdAt は書き換えられない', () => assertFails(updateDoc(doc(as('staff'), 'tracks/trackA'), { createdAt: serverTimestamp() })));
await t('T2 作成時に ownerUid を偽装できない', () => assertFails(setDoc(doc(as('u1'), 'tracks/forged'), {
  name: 'x', title: '', speaker: '', stopped: false, sessionStartedAt: serverTimestamp(),
  ownerUid: 'victim', createdAt: serverTimestamp() })));
await t('T2 正しい作成は通る', () => assertSucceeds(setDoc(doc(as('u1'), 'tracks/mine'), {
  name: 'My LT', title: '', speaker: '', stopped: false, sessionStartedAt: serverTimestamp(),
  ownerUid: 'u1', createdAt: serverTimestamp() })));

// --- 引き継ぎ（スタッフ → 登壇者）---------------------------------------
await t('HO 引き継ぎコードは誰も読めない',   () => assertFails(getDoc(doc(as('attacker'), 'tracks/trackA/private/handoff'))));
await t('HO owner 自身も読めない',           () => assertFails(getDoc(doc(as('staff'), 'tracks/trackA/private/handoff'))));
await t('HO owner 以外は private に書けない', () => assertFails(setDoc(doc(as('attacker'), 'tracks/trackA/private/handoff'), { code: 'X' })));
await t('HO 間違ったコードでは運用者になれない', () => assertFails(setDoc(doc(as('speaker1'), 'tracks/trackA/operators/speaker1'), { code: 'WRONG' })));
await t('HO 他人のUIDで登録できない',          () => assertFails(setDoc(doc(as('speaker1'), 'tracks/trackA/operators/speaker2'), { code: 'SECRET-123' })));
await t('HO 正しいコードで運用者になれる',      () => assertSucceeds(setDoc(doc(as('speaker1'), 'tracks/trackA/operators/speaker1'), { code: 'SECRET-123' })));
await t('HO 運用者は sessionStartedAt を書ける', () => assertSucceeds(updateDoc(doc(as('speaker1'), 'tracks/trackA'), { sessionStartedAt: serverTimestamp(), title: 'My Talk' })));
await t('HO 運用者でも ownerUid は奪えない',     () => assertFails(updateDoc(doc(as('speaker1'), 'tracks/trackA'), { ownerUid: 'speaker1' })));
await t('HO 運用者登録は上書きできない',         () => assertFails(updateDoc(doc(as('speaker1'), 'tracks/trackA/operators/speaker1'), { code: 'SECRET-123' })));

// --- T5: 入力の形を落とす -----------------------------------------------
await t('T5 空文字は投稿できない', () => assertFails(post(as('p1'), 'trackA', 'p1', '')));
await t('T5 61文字は投稿できない', () => assertFails(post(as('p1'), 'trackA', 'p1', 'あ'.repeat(61))));
await t('T5 60文字は投稿できる',   () => assertSucceeds(post(as('p60'), 'trackA', 'p60', 'あ'.repeat(60))));
await t('T5 余計なフィールドは落ちる', () => {
  const db = as('p2'); const b = writeBatch(db);
  b.set(doc(collection(db, 'tracks/trackA/comments')), { text: 'hi', createdAt: serverTimestamp(), color: 'red', uid: 'p2' });
  b.set(doc(db, 'tracks/trackA/posters/p2'), { lastPostAt: serverTimestamp() });
  return assertFails(b.commit());
});
await t('T5 createdAt のクライアント偽装は落ちる', () => {
  const db = as('p3'); const b = writeBatch(db);
  b.set(doc(collection(db, 'tracks/trackA/comments')), { text: 'hi', createdAt: Timestamp.fromMillis(0) });
  b.set(doc(db, 'tracks/trackA/posters/p3'), { lastPostAt: serverTimestamp() });
  return assertFails(b.commit());
});
await t('T5 数値テキストは落ちる', () => {
  const db = as('p4'); const b = writeBatch(db);
  b.set(doc(collection(db, 'tracks/trackA/comments')), { text: 12345, createdAt: serverTimestamp() });
  b.set(doc(db, 'tracks/trackA/posters/p4'), { lastPostAt: serverTimestamp() });
  return assertFails(b.commit());
});

// --- T3: 投稿は追記専用 -------------------------------------------------
await t('T3 コメントは書き換えられない', () => assertFails(updateDoc(doc(as('attacker'), 'tracks/trackA/comments/c1'), { text: 'hacked' })));
await t('T3 コメントは消せない',         () => assertFails(deleteDoc(doc(as('attacker'), 'tracks/trackA/comments/c1'))));
await t('T3 owner でもコメントは消せない', () => assertFails(deleteDoc(doc(as('staff'), 'tracks/trackA/comments/c1'))));

// --- T4: レート制限と読み取り量 -----------------------------------------
await t('T4 posters を伴わない単発投稿は落ちる',
  () => assertFails(setDoc(doc(collection(as('p5'), 'tracks/trackA/comments')), { text: 'solo', createdAt: serverTimestamp() })));
await t('T4 1投稿目は通る', () => assertSucceeds(post(as('p6'), 'trackA', 'p6', 'first')));
await t('T4 2秒以内の連投は落ちる', () => assertFails(post(as('p6'), 'trackA', 'p6', 'second')));
await t('T4 2秒待てば通る', async () => { await sleep(2300); return assertSucceeds(post(as('p6'), 'trackA', 'p6', 'third')); });
await t('T4 他人の posters は更新できない', () => assertFails(setDoc(doc(as('p7'), 'tracks/trackA/posters/p6'), { lastPostAt: serverTimestamp() })));
await t('T4 posters は読めない', () => assertFails(getDoc(doc(as('p6'), 'tracks/trackA/posters/p6'))));
await t('T4 limit 50 の購読は通る',  () => assertSucceeds(getDocs(query(collection(as('r1'), 'tracks/trackA/comments'), limit(50)))));
await t('T4 limit 51 の購読は落ちる', () => assertFails(getDocs(query(collection(as('r1'), 'tracks/trackA/comments'), limit(51)))));
await t('T4 limit 無しの全件取得は落ちる', () => assertFails(getDocs(collection(as('r1'), 'tracks/trackA/comments'))));
await t('T4 tracks 一覧の大量取得は落ちる', () => assertFails(getDocs(query(collection(as('r1'), 'tracks'), limit(500)))));

// --- 停止後 -------------------------------------------------------------
await t('ST 停止済みトラックには投稿できない', () => assertFails(post(as('p8'), 'stoppedTrack', 'p8', 'late')));
await t('ST 停止済みでも履歴は読める',         () => assertSucceeds(getDocs(query(collection(as('r1'), 'tracks/stoppedTrack/comments'), limit(50)))));

await env.cleanup();

const w = Math.max(...results.map(r => [...r[1]].length));
for (const [st, name, msg] of results) {
  console.log(`${st === 'PASS' ? '  ok ' : ' FAIL'} ${name}${msg ? '\n        -> ' + msg : ''}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
