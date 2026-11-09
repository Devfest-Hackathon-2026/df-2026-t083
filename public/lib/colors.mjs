// コメントの色。
//
// 定義は niconicomments（xpadev-net/niconicomments）の
// src/definition/colors.ts に合わせている。ニコニコ動画の色コマンドと
// 同じ名前・同じ色コードなので、観客にとっても登壇者にとっても馴染みがある。
//
// 保存するのは名前のほう（'red'）で、色コードは持たせない。
// あとで色味を調整しても、保存済みのコメントを書き換えずに済む。
//
// 自由な文字列は受けない。背景と同化する色や読めない色を投げ込む余地を作らない。
// この一覧は firestore.rules にも同じものが書いてある（Rules は import できない）。
// 食い違うと「画面では選べるのにサーバに弾かれる」が起きるので、
// scripts/lint-rules.mjs が両者の一致を見張っている。

/** 色名 → 色コード。並び順がそのまま投稿ページの並び順になる。 */
export const COLORS = {
  white:  '#FFFFFF',
  red:    '#FF0000',
  pink:   '#FF8080',
  orange: '#FFC000',
  yellow: '#FFFF00',
  green:  '#00FF00',
  cyan:   '#00FFFF',
  blue:   '#0000FF',
  purple: '#C000FF',
  black:  '#000000',
};

/** 色を選ばなかったときの色。古いコメントには色が入っていないので、そのぶんもこれ。 */
export const DEFAULT_COLOR = 'white';

export const COLOR_NAMES = Object.keys(COLORS);

/** 観客に見せる名前。色の名前だけだと、色が見えない人に何も伝わらない。 */
export const COLOR_LABELS = {
  white: '白', red: '赤', pink: '桃', orange: '橙', yellow: '黄',
  green: '緑', cyan: '水', blue: '青', purple: '紫', black: '黒',
};

/** 知らない色名は白に倒す。古いコメントや、将来減らした色のため。 */
export function colorCode(name) {
  return COLORS[name] ?? COLORS[DEFAULT_COLOR];
}

/**
 * 見本の上に載せる文字の色。
 *
 * 黒だけを特別扱いすると青（#0000FF）で読めなくなる。明るさで決める。
 * 色の名前を見本の中に書くのは、色が見えない人にも何を選んでいるか伝えるため。
 */
export function inkOn(name) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colorCode(name).slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // 白と黒の、相性のいいほう。黒は真っ黒にする。
  // #111111 だと紫（#C000FF）の上で 4.21 までしか出ない。
  return (1.05 / (L + 0.05)) > ((L + 0.05) / 0.05) ? '#FFFFFF' : '#000000';
}

/**
 * 縁取りの色。
 *
 * 黒い塗りのときだけ白へ反転する。本家 src/utils/color.ts と同じ考え方で、
 * 黒地に黒縁だと文字が消えるため。
 *
 * 濃さと太さは本家に揃えていない。本家は動画の上に載せるので薄い縁
 * （rgba 0.4 / 幅 2.8）だが、こちらは白地のスライドの上に載ることが多い。
 * 薄いと白い資料の上で白文字が読めなくなるので、濃いまま残している。
 */
export function strokeFor(name) {
  return colorCode(name) === COLORS.black
    ? 'rgba(255, 255, 255, 0.85)'
    : 'rgba(0, 0, 0, 0.85)';
}
