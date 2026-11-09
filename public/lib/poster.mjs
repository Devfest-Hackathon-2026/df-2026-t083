// 投稿ページ。観客が暗い客席でスマホから使う。
//
// 送れないときに無言にしないことが、このページでいちばん大事。
// 「届いたかどうか」は、送れた1件が入力欄から左へ抜ける動きで示す。
// bus.post() は書き込みが通ったときだけ返るので、動いた時点で届いている。
import { start } from './app.mjs';
import { createBus, MAX_TEXT, COOLDOWN_MS } from './bus.mjs';
import { COLORS, COLOR_NAMES, COLOR_LABELS, DEFAULT_COLOR, colorCode, strokeFor, inkOn } from './colors.mjs';

/** 選んだ色は端末に残す。同じ人が送るたびに選び直さなくていい。 */
const HUE_KEY = 'danmaku:color';

/**
 * 送れない理由を観客の言葉にする。
 * 文字数超過は「何文字削るか」まで出す。足りない情報は人が数えることになる。
 */
export function reasonText(kind, { over = 0, waitMs = 0 } = {}) {
  switch (kind) {
    case 'empty':     return 'なにか書いてから送ってください';
    case 'too-long':  return `${MAX_TEXT}文字を超えています。あと${over}文字削ってください`;
    case 'cooldown':  return `送信しました。あと${Math.ceil(waitMs / 1000)}秒で次を送れます`;
    case 'stopped':   return 'いまこのトラックは投稿を受け付けていません';
    case 'offline':   return 'つながっていません。電波を確かめてもう一度';
    default:          return '送れませんでした。少し待ってもう一度';
  }
}

export async function createPoster({ eventId, trackId, now = () => Date.now() } = {}) {
  const el = (id) => document.getElementById(id);
  const note = (text, kind = '') => { el('note').textContent = text; el('note').dataset.kind = kind; };

  if (!eventId || !trackId) {
    el('title').textContent = 'リンクが正しくありません';
    note('QRコードをもう一度読み取ってください', 'bad');
    return null;
  }

  let bus;
  try {
    const { uid, db, sdk } = await start();
    bus = createBus(sdk, { db, eventId, trackId, uid, now });
  } catch {
    el('title').textContent = 'つながりません';
    note(reasonText('offline'), 'bad');
    return null;
  }

  let track = null;
  let timer = 0;

  // --- 色を選ぶ ---------------------------------------------------------
  let hue = DEFAULT_COLOR;
  try {
    const saved = localStorage.getItem(HUE_KEY);
    if (COLOR_NAMES.includes(saved)) hue = saved;
  } catch { /* 使えない端末では既定の白のまま */ }

  for (const name of COLOR_NAMES) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'hue';
    radio.value = name;
    radio.checked = name === hue;
    const swatch = document.createElement('span');
    swatch.textContent = COLOR_LABELS[name];
    swatch.style.setProperty('--sw', COLORS[name]);
    // 見本の上の文字。明るさで決める（黒だけ特別扱いすると青で読めない）。
    swatch.style.setProperty('--swInk', inkOn(name));
    radio.addEventListener('change', () => {
      hue = name;
      try { localStorage.setItem(HUE_KEY, name); } catch { /* 残らないだけ */ }
    });
    label.append(radio, swatch);
    el('hue').append(label);
  }

  bus.watchTrack((t) => {
    track = t;
    if (!t) {
      el('track').textContent = 'このトラックはありません';
      el('title').textContent = '';
      note('QRコードを確かめてください', 'bad');
      refresh();
      return;
    }
    el('track').textContent = t.name;
    // 再スキャンは要らないことを伝える。QR は貼り替わらない。
    el('title').textContent = t.stopped ? '受付を待っています' : '受付中';
    el('title').dataset.kind = t.stopped ? 'wait' : 'live';
    refresh();
  }, () => { el('track').textContent = '読み取れません'; note(reasonText('denied'), 'bad'); });


  /**
   * 送れる状態かを見直す。
   *
   * 文字数超過でも入力は止めない。貼り付けを黙って切ると、何を消されたか分からない。
   * 超えた分を数えて「あと何文字」を出す。
   */
  function refresh() {
    const len = el('text').value.trim().length;
    const over = Math.max(0, len - MAX_TEXT);
    el('count').textContent = `${len} / ${MAX_TEXT}`;
    el('count').dataset.over = over > 0 ? '1' : '';
    el('text').dataset.over = over > 0 ? '1' : '';

    const waitMs = bus.cooldownRemaining();
    const notLive = track === null || track.stopped;
    const blocked = len === 0 || over > 0 || waitMs > 0 || notLive;
    el('send').disabled = blocked;
    // 入力そのものが不正なのか、周りの都合で送れないのかを区別して伝える
    el('text').setAttribute('aria-invalid', over > 0 ? 'true' : 'false');
    // 待っている間は、ボタンにも残り秒数を出す。状態行だけだと見落とす。
    el('sendLabel').textContent = waitMs > 0 ? `あと${Math.ceil(waitMs / 1000)}秒` : '送信';
    // 秒数が変わるまでの間も動かす。止まっていると壊れていると思われる。
    // 満ちるまでが待ち時間。溜まり切ったら押せる。
    el('send').style.setProperty('--p',
      String(waitMs > 0 ? 1 - waitMs / COOLDOWN_MS : 0));

    if (over > 0) note(reasonText('too-long', { over }), 'bad');
    else if (track && track.stopped) note(reasonText('stopped'), 'wait');
    else if (waitMs > 0) note(reasonText('cooldown', { waitMs }), 'ok');
  }

  /** クールダウン中は毎秒出し直す。無言で押せなくすると壊れていると思われる。 */
  function tick() {
    clearInterval(timer);
    timer = setInterval(() => {
      refresh();
      if (bus.cooldownRemaining() <= 0) {
        clearInterval(timer); timer = 0;
        if (!track?.stopped) note('送るとスライドの上に流れます');
      }
    }, 200);
  }

  /**
   * 送れた1件を左へ逃がす。
   *
   * 入力欄が空になるだけだと、消えたのか送れたのかが分からない。
   * スライドの上で起きることと同じ向きに動かして、送った先を指す。
   */
  function fly(text) {
    const ta = el('text');
    const ghost = document.createElement('div');
    ghost.className = 'fly';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = text;
    // 飛んでいくものを、スライドに出るのと同じ色で描く
    ghost.style.color = colorCode(hue);
    ghost.style.webkitTextStroke = `2px ${strokeFor(hue)}`;
    ghost.style.paintOrder = 'stroke fill';
    // ラベルの高さは文字の大きさで変わる。入力欄の実際の位置から置く。
    ghost.style.top = `${ta.offsetTop + 10}px`;
    ghost.style.left = `${ta.offsetLeft + 12}px`;
    ta.parentElement.append(ghost);
    // 動きを減らす設定だと animationend がほぼ即座に来る。来ない場合に備えて保険も置く。
    const drop = () => ghost.remove();
    ghost.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 1200);
  }

  async function submit() {
    const value = el('text').value;
    if (value.trim().length === 0) return;
    el('send').disabled = true;
    try {
      await bus.post(value, hue);
      // 送れたら即空にする。続けて打てることが弾幕の体験なので。
      el('text').value = '';
      fly(value.trim());
      note(reasonText('cooldown', { waitMs: COOLDOWN_MS }), 'ok');
      tick();
    } catch (e) {
      const over = Math.max(0, value.trim().length - MAX_TEXT);
      note(reasonText(e.kind, { over, waitMs: bus.cooldownRemaining() }),
        e.kind === 'cooldown' || e.kind === 'stopped' ? 'wait' : 'bad');
      if (e.kind === 'cooldown') tick();
    } finally {
      refresh();
      el('text').focus();
    }
  }

  el('text').addEventListener('input', refresh);
  el('send').addEventListener('click', submit);
  el('text').addEventListener('keydown', (e) => {
    // スマホの改行は潰さない。送信は Cmd/Ctrl + Enter。
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });

  refresh();
  el('text').focus();
  return { bus, submit, refresh, get track() { return track; } };
}
