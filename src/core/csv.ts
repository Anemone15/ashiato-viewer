import { RawLog, STATUS } from './types';

const STATUS_MAP: Record<string, number> = {
  通過: STATUS.pass,
  移動: STATUS.move,
  Point出発: STATUS.depart,
  滞在: STATUS.stay,
  その他: STATUS.other,
};

/** "2023-01-04T13:50:58.903+0900" → epoch ms */
function parseTime(s: string): number {
  // +0900 形式を +09:00 に
  const m = /([+-]\d{2})(\d{2})$/.exec(s);
  return Date.parse(m ? s.slice(0, m.index) + m[1] + ':' + m[2] : s);
}

function splitRow(line: string): string[] {
  // 全フィールドがダブルクォートで囲まれている前提だが、念のため一般的な CSV も扱う
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      let s = '';
      while (j < line.length) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') { s += '"'; j += 2; continue; }
          break;
        }
        s += line[j++];
      }
      out.push(s);
      i = j + 2; // 閉じクォートとカンマ
    } else {
      let j = line.indexOf(',', i);
      if (j < 0) j = line.length;
      out.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

/** 足跡アプリの CSV テキスト（複数可）を読み込んで1つの RawLog にまとめる */
export function parseCsvTexts(texts: string[]): RawLog {
  const t: number[] = [], lat: number[] = [], lon: number[] = [], acc: number[] = [], status: number[] = [];
  for (const text of texts) {
    const lines = text.split(/\r?\n/);
    for (let n = 1; n < lines.length; n++) {
      const line = lines[n];
      if (!line) continue;
      const f = splitRow(line);
      if (f.length < 4) continue;
      const st = STATUS_MAP[f[0]] ?? STATUS.other;
      const la = Number(f[1]), lo = Number(f[2]), tt = parseTime(f[3]);
      if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(tt)) continue;
      t.push(tt);
      lat.push(la);
      lon.push(lo);
      acc.push(f[4] ? Number(f[4]) : NaN);
      status.push(st);
    }
  }
  return {
    t: Float64Array.from(t),
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    acc: Float32Array.from(acc),
    status: Uint8Array.from(status),
  };
}
