// 読み込んだ CSV を端末内（IndexedDB）に保存する。データは外部に送信しない。
export interface StoredFile {
  name: string;
  size: number;
  /** サーバー(data/)から取得した場合の更新時刻 */
  mtime?: number;
  text: string;
}

const DB = 'ashiato-viewer';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function loadFiles(): Promise<StoredFile[]> {
  try {
    return ((await tx('readonly', (s) => s.getAll())) as StoredFile[]) ?? [];
  } catch {
    return [];
  }
}

export async function saveFiles(files: StoredFile[], replace = false) {
  try {
    await tx('readwrite', (s) => {
      if (replace) s.clear();
      for (const f of files) s.put(f);
    });
  } catch {
    // 保存できない環境（プライベートブラウズ等）では毎回読み込み直す
  }
}

export async function clearFiles() {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* noop */
  }
}

/** Mac で起動したサーバーの data/ フォルダにある CSV 一覧（無ければ null） */
export async function fetchServerIndex(): Promise<{ name: string; size: number; mtime: number }[] | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}userdata/index.json`, { cache: 'no-store' });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function fetchServerFile(name: string): Promise<string> {
  const r = await fetch(`${import.meta.env.BASE_URL}userdata/${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name} を取得できませんでした`);
  return r.text();
}

/** サーバーの一覧と端末内の保存内容が一致しているか */
export function sameAsServer(local: StoredFile[], server: { name: string; size: number; mtime: number }[]) {
  const fromServer = local.filter((f) => f.mtime !== undefined);
  if (fromServer.length !== server.length) return false;
  return server.every((s) => fromServer.some((f) => f.name === s.name && f.size === s.size && f.mtime === s.mtime));
}

// 場所の名前（ユーザーが付けたもの）はブラウザの localStorage に保存
export interface PlaceName { lat: number; lon: number; name: string }
const PLACE_KEY = 'ashiato-place-names';
export function loadPlaceNames(): PlaceName[] {
  try {
    return JSON.parse(localStorage.getItem(PLACE_KEY) || '[]');
  } catch {
    return [];
  }
}
export function savePlaceNames(names: PlaceName[]) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(names));
  } catch {
    /* noop */
  }
}

/** Mac の data/place-names.json（CLI・API と共有）。サーバーが無い・未保存なら null */
export async function fetchServerPlaceNames(): Promise<PlaceName[] | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}userdata/place-names.json`, { cache: 'no-store' });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
    const list = await r.json();
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export async function saveServerPlaceNames(names: PlaceName[]) {
  try {
    await fetch(`${import.meta.env.BASE_URL}userdata/place-names.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(names),
    });
  } catch {
    // サーバー無しで使っている場合は端末内にだけ保存
  }
}
