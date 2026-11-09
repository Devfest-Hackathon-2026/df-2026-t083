// レンダラに渡す口。contextIsolation の既定（有効）のまま、必要な分だけ通す。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  // 運営のリンクから渡ってきたトラックを受け取る
  onTrack: (fn) => ipcRenderer.on('track', (_e, id) => fn(id)),
  displays: () => ipcRenderer.invoke('displays'),
  start: (args) => ipcRenderer.invoke('start', args),
  stop: () => ipcRenderer.invoke('stop'),
  // クリックを下に通すかどうかはキーでも切り替わる。値の持ち主は main なので、
  // 画面に出すぶんは送られてきたものを使う。こちらで反転させない。
  onClickThrough: (fn) => ipcRenderer.on('clickThrough', (_e, on) => fn(on)),
  setClickThrough: (on) => ipcRenderer.invoke('clickThrough', on),
  quit: () => ipcRenderer.invoke('quit'),
  origin: () => ipcRenderer.invoke('origin'),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
});
