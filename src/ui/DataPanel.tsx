import { useState } from 'react';
import type { AppData } from './appdata';
import { fmtDateTime } from './format';

export function DataPanel({
  data, onImport, onReloadServer, onClear,
}: {
  data: AppData | null;
  onImport: (files: File[]) => void;
  onReloadServer: () => void;
  onClear: () => void;
}) {
  const [over, setOver] = useState(false);
  const pick = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.name.toLowerCase().endsWith('.csv'));
    if (files.length) onImport(files);
  };
  const s = data?.a.stats;
  return (
    <div>
      {!data && (
        <p>
          iPhone の位置記録アプリから書き出した CSV を読み込んでください。
          データはこの端末の中だけで処理・保存され、外部には送信されません。
        </p>
      )}
      <label
        className={`drop${over ? ' over' : ''}`}
        style={{ display: 'block', cursor: 'pointer' }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      >
        <input type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => pick(e.target.files)} />
        CSV ファイルを選択（複数可）またはここにドロップ
        <div className="muted small">期間が重なっていても重複は自動で取り除きます</div>
      </label>

      {data && s && (
        <>
          <div className="section">読み込み済みのデータ</div>
          <table className="data">
            <tbody>
              {data.files.map((f) => (
                <tr key={f.name}><td>{f.name}</td><td className="num">{(f.size / 1e6).toFixed(1)}MB</td></tr>
              ))}
            </tbody>
          </table>
          <table className="data" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>記録期間</td><td className="num">{fmtDateTime(s.firstT)} 〜 {fmtDateTime(s.lastT)}</td></tr>
              <tr><td>CSV の行数</td><td className="num">{s.rawRows.toLocaleString()}</td></tr>
              <tr><td>軌跡に使った点</td><td className="num">{s.trackPoints.toLocaleString()}</td></tr>
              <tr><td>除去した異常値</td><td className="num">{s.removedOutliers.toLocaleString()}</td></tr>
              <tr><td>記録のある日数</td><td className="num">{s.days.toLocaleString()}</td></tr>
              <tr><td>移動 / 滞在</td><td className="num">{data.a.trips.length.toLocaleString()} / {data.a.stays.length.toLocaleString()}</td></tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={onReloadServer}>Mac の data フォルダから再読み込み</button>
            <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => confirm('この端末に保存した CSV をすべて削除しますか？') && onClear()}>
              端末内のデータを削除
            </button>
          </div>
        </>
      )}

      <div className="section">移動手段の判定方法</div>
      <ul className="small muted" style={{ paddingLeft: 18, marginTop: 0 }}>
        <li>同じ場所に10分以上いた所を「滞在」とし、滞在と滞在の間を1回の「移動」としています。</li>
        <li>移動の中を、歩く速さかどうかで区間に分け、乗り物の区間は速度・線路との距離・海上かどうかで判定します。</li>
        <li>線路（国土数値情報の鉄道データ）に沿って走り、駅で止まっていれば「電車」、新幹線の線路上を高速で走れば「新幹線」。</li>
        <li>記録が途切れた区間（地下鉄・トンネル・機内など）は、前後の位置と所要時間から推定します（点線で表示）。</li>
        <li>車とバスは区別できないため「車・バス」にまとめています。</li>
      </ul>
      <p className="small muted">
        出典: 国土数値情報（鉄道データ）国土交通省 / 市区町村境界: スマートニュース メディア研究所（国土数値情報 行政区域データを加工）/ 地図: 地理院タイル
      </p>
    </div>
  );
}
