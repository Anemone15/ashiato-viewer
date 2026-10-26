# 検索・集計 API ガイド

足跡ビューアの解析結果（移動・区間・滞在・駅・市区町村）を、プログラムや AI エージェント（Claude Cowork / Claude Desktop / Claude Code など）から検索・集計するための API です。
Web アプリと同じ解析ロジック（`src/core/`）を Node で動かしています。

- 引数・戻り値の一覧: **[API-reference.md](API-reference.md)**（コードから自動生成）
- AI エージェント向けのスキル: **[../skills/ashiato-viewer/SKILL.md](../skills/ashiato-viewer/SKILL.md)**

> ⚠️ **位置履歴は自宅・勤務先・行動パターンがわかる個人情報です。** どの方法も既定ではこの Mac の中だけで動き、外部には送信しません。
> HTTP API を LAN に公開するときはトークン認証が必須です。AI エージェントに渡す結果も、必要な範囲にとどめてください。

---

## 1. 3つの使い方

| 方法 | 向いている用途 | 起動 |
|---|---|---|
| **MCP サーバー** | Claude Desktop・Cowork・Claude Code からツールとして呼ぶ（おすすめ） | Claude の設定に登録（下記） |
| **CLI** | シェルが使えるエージェント、スクリプト、手作業での確認 | `./bin/ashiato <command> ...` |
| **HTTP API** | 他のアプリ・ノートブック・ショートカットなどから | `npm run api:serve` → `http://127.0.0.1:5190/api` |

3つとも同じコマンド（`summary` / `search_trips` / `search_legs` / `aggregate` / `day` / `trip` / `places` / `place_visits` / `municipalities` / `stations`）と同じ引数を使えます。

### 準備

```bash
npm install
# data/ に位置記録アプリの CSV を置く（Web アプリと共通）
./bin/ashiato summary
```

初回は解析に1秒ほどかかります（MCP・HTTP サーバーは解析結果をメモリに持ち、CSV が変わると自動で解析し直します）。

---

## 2. MCP サーバー

### Claude Desktop / Cowork

1. 1ファイル版をビルドします（Node だけで動き、ビルド後は `node_modules` 不要）。

   ```bash
   npm run build:agent
   ```

2. Claude Desktop の設定 → 開発者 → 「構成を編集」で `claude_desktop_config.json` を開き、次を追加して Claude Desktop を再起動します。
   `node` は `which node` で表示される絶対パスに、プロジェクトのパスは自分の環境に合わせてください。

   ```json
   {
     "mcpServers": {
       "ashiato-viewer": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/Users/<you>/projects/ashiato_viewer/dist-agent/mcp-server.mjs"]
       }
     }
   }
   ```

3. 会話（または Cowork のタスク）で「足跡ビューアで、去年いちばん長く電車に乗った日は？」のように頼むと、Claude が `ashiato-viewer` のツールを使います。

- MCP サーバーは Mac 上で動きます。Cowork でこのコネクタが使えない環境では、プロジェクトのフォルダを Cowork の作業フォルダに選び、CLI（`./bin/ashiato`）を使ってもらってください（[skills/ashiato-viewer/SKILL.md](../skills/ashiato-viewer/SKILL.md) をスキルとして追加すると手順を理解して実行します）。
- コードを変更したら `npm run build:agent` をやり直して Claude Desktop を再起動してください。
- 開発中は `"command": "<プロジェクト>/node_modules/.bin/tsx", "args": ["<プロジェクト>/scripts/mcp-server.ts"]` にすると、ビルドなしで変更が反映されます。

### Claude Code

```bash
claude mcp add ashiato-viewer -- "$PWD/node_modules/.bin/tsx" "$PWD/scripts/mcp-server.ts"
```

### 提供するツール

コマンドと同じ名前の10個のツールです（すべて読み取り専用）。サーバーは「まず `summary`、駅名は `stations`・場所名は `places` で確認してから検索」という使い方の指示もエージェントに渡します。

---

## 3. CLI

```bash
./bin/ashiato help                          # コマンド一覧
./bin/ashiato help search_legs              # 引数の説明と例
./bin/ashiato search_trips --from 新宿 --to 東京 --limit 5
```

- 引数は `--名前 値`。`--date-from` のようなケバブケースも `dateFrom` として受け付けます。
- 配列はカンマ区切り（`--modes train,car`）か繰り返し（`--via 品川 --via 横浜`）。
- 複雑な条件は JSON でまとめて渡せます: `--json '{"near":{"lat":35.681,"lon":139.767,"radiusM":300}}'`（`--json -` で標準入力から）。
- 結果は標準出力に JSON。`--compact` で1行、`--out ファイル` でファイルに保存。
- エラー時は `{"error": "...", "details": ...}` を出して終了コード 1。
- どのフォルダからでも実行できます。`ASHIATO_DATA_DIR` か `--data-dir` で CSV のフォルダを変えられます。

`npm run -s api -- <command> ...` でも同じです（`-s` を付けないと npm の表示が JSON の前に混ざります）。

Mac 以外（Cowork のサンドボックスなど Linux 環境）では `node_modules` の実行ファイルが動かないため、`bin/ashiato` は自動的に `dist-agent/ashiato.mjs`（`npm run build:agent` で作る1ファイル版）を使います。

---

## 4. HTTP API

```bash
npm run api:serve                     # http://127.0.0.1:5190/api（この Mac からだけ）
```

```bash
curl 'http://127.0.0.1:5190/api'                                         # コマンド一覧と引数の説明
curl 'http://127.0.0.1:5190/api/search_legs?modes=car&minKmh=80&minMinutes=20'
curl 'http://127.0.0.1:5190/api/search_legs?weekdays=sat&weekdays=sun&line=環状線'   # 繰り返しで配列
curl -X POST 'http://127.0.0.1:5190/api/aggregate' \
  -H 'Content-Type: application/json' -d '{"groupBy":["month","mode"],"sortBy":"key"}'
curl 'http://127.0.0.1:5190/api/search_trips?format=csv&limit=1000' -o trips.csv
```

| 状態 | 意味 |
|---|---|
| 200 | 成功（`format=csv` のときは `text/csv`） |
| 400 | 引数の誤り・駅名が見つからない（`details` に原因や候補） |
| 401 | トークンが必要 |
| 404 | 不明なコマンド |

LAN の他の端末から使う場合（iPhone のショートカットなど）は、必ずトークンを設定します。

```bash
ASHIATO_API_TOKEN='長いランダムな文字列' npm run api:serve -- --host 0.0.0.0
curl -H 'Authorization: Bearer 長いランダムな文字列' 'http://<MacのIP>:5190/api/summary'
```

---

## 5. データのモデル

| 用語 | 意味 |
|---|---|
| **trip（移動）** | 滞在（10分以上とどまった場所）から次の滞在までの1回の移動。`id` で `trip` コマンドに渡せる |
| **leg（区間）** | trip の中のひと続きの部分（徒歩・電車・車…）。電車の区間は乗車駅（`board`）・通過駅（`via`）・降車駅（`alight`）を持つ |
| **place（場所）** | 滞在地をまとめたもの。最も長く滞在した場所が「自宅（推定）」（引数では `"home"`） |
| **mode（手段）** | `walk` 徒歩 / `bicycle` 自転車 / `car` 車・バス / `train` 電車 / `shinkansen` 新幹線 / `ship` 船 / `plane` 飛行機 / `unknown` 不明（日本語名でも指定可） |

- 日時はすべて日本時間（`+09:00`）。日付の条件は trip の出発日（`search_legs` では区間の開始日）で判定します。
- 手段・駅は GPS の速度と線路・海上の位置からの**推定**です。`inferred: true` の区間は記録の途切れ（地下鉄・トンネル・機内など）を推定で補っています。
- `topKmh` は区間内の速度の95パーセンタイル（瞬間的なGPSのぶれを除いた最高速度）。

### 場所の名前

Web アプリの「場所」タブで付けた名前は `data/place-names.json` に保存され（Web アプリを `npm run dev` で開いている場合）、API でも同じ名前で検索・表示されます。
手で編集する場合の形式: `[{"lat": 35.0, "lon": 135.0, "name": "会社"}]`（150m 以内の場所に適用）。

---

## 6. 条件の組み合わせ方

`search_trips` / `search_legs` / `aggregate` は同じフィルターを使えます（詳細は [API-reference.md](API-reference.md)）。

| 分類 | 引数 |
|---|---|
| 日時 | `dateFrom` `dateTo` `weekdays` `hourFrom` `hourTo`（22〜4 のような日付またぎ可） |
| 駅 | `from` → `via`（複数・順序どおり）→ `to`、`strictEnds`（false で通過も一致） |
| 区間 | `modes` `line` `operator` `minKmh` `maxKmh` `minTopKmh` `minMinutes` `maxMinutes` `minKm` `maxKm` `inferred` |
| 場所・エリア | `fromPlace` `toPlace`（`"home"` = 自宅） `near`（地点＋半径） `prefecture` `municipality` |
| 出力 | `sort` `limit` `offset` `format`（`json` / `csv` / `geojson`）、`search_trips` は `detail` |

- `search_trips`: 区間の条件は「その移動のどれか1つの区間が満たせば一致」。駅の条件は移動全体（乗り換えをまたいでよい）で判定。
- `search_legs`: すべての条件をその区間1つで判定（駅もその区間の乗車・通過・降車駅）。
- `aggregate`: 条件に合う区間（`unit: "trips"` なら移動）を `groupBy`（最大3キー）でまとめる。

---

## 7. 質問 → 呼び出し例

| 知りたいこと | 呼び出し |
|---|---|
| 全体像 | `summary` |
| A駅で乗ってB駅で降りた回数と一覧 | `search_trips --from A --to B` |
| A駅を通ってB駅へ（乗り換え含む） | `search_trips --via A --to B` |
| 時速60km以上で30分以上電車に乗った | `search_legs --modes train --min-kmh 60 --min-minutes 30` |
| 車で一番速く走った区間 | `search_legs --modes car --sort -speed --limit 5` |
| 新幹線・飛行機・船の利用歴 | `search_legs --modes shinkansen,plane,ship --limit 100` |
| 月別・手段別の距離 | `aggregate --group-by month,mode --sort-by key` |
| よく乗る区間ベスト10（2025年） | `aggregate --modes train --group-by section --date-from 2025-01-01 --date-to 2025-12-31 --limit 10` |
| 路線ごとの乗車回数と距離 | `aggregate --modes train --group-by line --sort-by distance` |
| 曜日×時間帯の出発回数 | `aggregate --unit trips --group-by weekday,hour --sort-by key --limit 200` |
| 自宅からの行き先ランキング | `aggregate --unit trips --from-place home --group-by toPlace` |
| 夜遅く（22〜4時）に帰宅した回数 | `search_trips --to-place home --hour-from 22 --hour-to 4 --limit 1`（`total` を見る） |
| ある地点の近くを通った移動 | `search_trips --near 35.681,139.767,300` |
| 京都府を通った週末の移動 | `search_trips --prefecture 京都 --weekdays 土,日` |
| ある日の行動 | `day --date 2025-04-01` |
| 今年初めて行った場所 | `places --first-from 2026-01-01 --sort -first` |
| 行ったことのない市区町村 | `municipalities --prefecture 奈良 --unvisited true` |
| 表計算用に書き出す | `search_legs --modes train --limit 1000 --format csv --out rides.csv` |
| 地図ソフト用に軌跡を書き出す | `search_legs --modes car --min-km 50 --format geojson --out drives.geojson` |

件数が多いときは `total`（全件数）と `totals`（距離などの合計）が返るので、一覧が必要ないなら `--limit 1` で十分です。

---

## 8. 開発メモ

- コマンドの定義は [`src/api/commands.ts`](../src/api/commands.ts)（zod で引数を定義し、CLI・HTTP・MCP で共有）。
- フィルターと集計は [`src/core/filter.ts`](../src/core/filter.ts)・[`src/core/aggregate.ts`](../src/core/aggregate.ts)（ブラウザでも動く純粋な TypeScript）。
- コマンドや引数を変えたら `npm run docs:api` で [API-reference.md](API-reference.md) を作り直し、`npm run build:agent` で1ファイル版を更新してください。
