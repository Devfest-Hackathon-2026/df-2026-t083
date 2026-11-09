import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLORS, COLOR_NAMES, COLOR_LABELS, DEFAULT_COLOR, colorCode, strokeFor, inkOn } from '../../public/lib/colors.mjs';

test('色の一覧が Rules と一致している', () => {
  // Rules は import できないので同じ一覧が2か所にある。
  // 片方だけ増えると「画面では選べるのにサーバが弾く」になる。
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const m = rules.match(/request\.resource\.data\.color in\s*\[([^\]]*)\]/s);
  assert.ok(m, 'Rules に色の一覧が無い');
  const listed = [...m[1].matchAll(/'([a-z0-9]+)'/g)].map((x) => x[1]);
  assert.deepEqual(listed, COLOR_NAMES);
});

test('色コードは niconicomments と同じ', () => {
  // xpadev-net/niconicomments src/definition/colors.ts
  assert.equal(COLORS.white, '#FFFFFF');
  assert.equal(COLORS.red, '#FF0000');
  assert.equal(COLORS.pink, '#FF8080');
  assert.equal(COLORS.orange, '#FFC000');
  assert.equal(COLORS.yellow, '#FFFF00');
  assert.equal(COLORS.green, '#00FF00');
  assert.equal(COLORS.cyan, '#00FFFF');
  assert.equal(COLORS.blue, '#0000FF');
  assert.equal(COLORS.purple, '#C000FF');
  assert.equal(COLORS.black, '#000000');
});

test('既定は白', () => {
  assert.equal(DEFAULT_COLOR, 'white');
  assert.equal(colorCode(DEFAULT_COLOR), '#FFFFFF');
});

test('知らない色名は白に倒す', () => {
  // 古いコメント、将来減らした色、壊れた値のどれでも落ちない
  for (const bad of ['rainbow', '', null, undefined, '#FF0000', 'WHITE']) {
    assert.equal(colorCode(bad), '#FFFFFF', String(bad));
  }
});

test('黒のときだけ縁を白へ反転する', () => {
  // 黒地に黒縁だと文字が消える（niconicomments と同じ考え方）
  assert.match(strokeFor('black'), /255, 255, 255/);
  for (const name of COLOR_NAMES.filter((n) => n !== 'black')) {
    assert.match(strokeFor(name), /0, 0, 0/, name);
  }
});

test('どの色にも観客向けの名前がある', () => {
  // 色だけで示すと、色が見えない人に何も伝わらない
  for (const name of COLOR_NAMES) {
    assert.ok((COLOR_LABELS[name] ?? '').length > 0, name);
  }
});

test('見本の文字がどの色の上でも読める', () => {
  // 黒だけ特別扱いしていたとき、青（#0000FF）の上の文字が読めなかった
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  for (const name of COLOR_NAMES) {
    const r = ratio(inkOn(name), COLORS[name]);
    assert.ok(r >= 4.5, `${name}: ${r.toFixed(2)}`);
  }
});
