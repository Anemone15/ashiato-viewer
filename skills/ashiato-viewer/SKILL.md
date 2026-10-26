---
name: ashiato-viewer
description: ユーザー本人の移動履歴（iPhone の位置記録を解析した、どこへ・いつ・何で移動したか）を検索・集計する。「○○駅から△△駅に何回行った」「去年電車に何km乗った」「この日どこにいた」「時速○km以上で○分以上移動したのはいつ」「初めて行った場所」「行ったことのある市区町村」など、ユーザー自身の移動・外出・乗車・訪問の記録についての質問で使う。足跡ビューア（ashiato-viewer）の MCP ツールか CLI を使う。
---

# 足跡ビューアで移動履歴を調べる

ユーザーの位置記録を解析したデータに、検索・集計の API でアクセスする。データはユーザーの Mac の中にあり、**個人情報**（自宅・行動パターン）なので、結果をユーザーの許可なく外部サービスへ送らない。

## 使う手段

1. **MCP ツールがあればそれを使う**（`summary`, `search_trips`, `search_legs`, `aggregate`, `day`, `trip`, `places`, `place_visits`, `municipalities`, `stations`。サーバー名 `ashiato-viewer`）。
2. 無ければ **CLI** をシェルで実行する。プロジェクトのフォルダ（`bin/ashiato` があるフォルダ）で:

   ```bash
   ./bin/ashiato help                 # コマンド一覧
   ./bin/ashiato help search_legs     # 引数の説明
   ./bin/ashiato search_trips --from 新宿 --to 東京 --limit 5
   ./bin/ashiato aggregate --json '{"groupBy":["month","mode"],"sortBy":"key"}'
   ```

   結果は標準出力に JSON。失敗時は `{"error": ...}` と終了コード 1。`dist-agent/ashiato.mjs` が無いと言われたら、ユーザーに Mac で `npm run build:agent` を実行してもらう。

## 進め方

1. **最初に `summary`** で記録期間・手段ごとの合計・よく乗る区間・よく行く場所をつかむ。
2. **名前を確かめる**: 駅名は `stations --query <一部>`、場所名は `places --query <一部>`。自宅は `"home"`。駅名に「駅」は付けない。存在しない駅名はエラーになり `details.suggestions` に候補が出る。
3. **目的に合うコマンドを選ぶ**
   - 「1回の外出・移動」を数える/列挙する → `search_trips`（駅条件は乗り換えをまたいで判定）
   - 「電車に乗っていた間」「車で走った間」など乗り物単位 → `search_legs`
   - 回数・距離・時間を何かごとに集計 → `aggregate`（`groupBy` 最大3つ。`unit: "trips"` で移動単位）
   - 特定の日 → `day`、特定の移動の詳細や軌跡 → `trip --id N --track true`
   - 場所・訪問 → `places` / `place_visits`、市区町村の制覇 → `municipalities`
4. **件数だけ知りたいときは `limit: 1`** にして `total`・`totals` を読む（一覧を全部取らない）。多い一覧は `offset` でページ送り。
5. 表やファイルが欲しいと言われたら `format: "csv"`（表計算）/ `"geojson"`（地図）。CLI なら `--out ファイル名`。

## 条件の早見表

| 分類 | 引数 |
|---|---|
| 日時（JST） | `dateFrom` `dateTo`（YYYY-MM-DD）, `weekdays`（0=日…6=土 または "土,日"）, `hourFrom` `hourTo`（22〜4 のような日付またぎ可） |
| 駅 | `from`（乗車）, `via`（順序どおり複数）, `to`（降車）, `strictEnds: false` で通過も一致 |
| 区間 | `modes`（walk/bicycle/car/train/shinkansen/ship/plane/unknown）, `line`, `operator`, `minKmh` `maxKmh`（平均）, `minTopKmh`（最高）, `minMinutes` `maxMinutes`, `minKm` `maxKm`, `inferred` |
| 場所・エリア | `fromPlace` `toPlace`（部分一致・"home"）, `near: {lat, lon, radiusM}`, `prefecture`, `municipality` |
| 出力 | `sort`（`-start` 新しい順 / `-distance` / `-duration` / `-speed`）, `limit`, `offset`, `format` |

`aggregate` の `groupBy`: 区間単位 `mode year month date weekday hour line operator board alight station section fromPlace toPlace`、移動単位 `year month date weekday hour fromPlace toPlace route mainMode`。

## 結果を伝えるときの注意

- 手段・駅は GPS の速度と線路の位置からの**推定**。`inferred: true` は記録の途切れ（地下鉄・トンネル・機内）を補った区間。断定しすぎず、必要なら「推定」と添える。
- 車とバスは区別できない（`car` = 車・バス）。
- 日時は日本時間（+09:00）。
- 座標や自宅の位置をそのまま長々と出さない。ユーザーが求めた粒度で答える。

## 例

- 「新宿から東京まで何回電車に乗った？」→ `search_trips {from:"新宿", to:"東京", limit:1}` の `total`
- 「2025年に新幹線で行った所」→ `search_legs {modes:["shinkansen"], dateFrom:"2025-01-01", dateTo:"2025-12-31"}`
- 「時速100km以上で30分以上走ったドライブ」→ `search_legs {modes:["car"], minKmh:100, minMinutes:30, sort:"-distance"}`
- 「月ごとの電車の距離をグラフにしたい」→ `aggregate {modes:["train"], groupBy:["month"], sortBy:"key", format:"csv"}`
- 「週末によく行く場所」→ `aggregate {unit:"trips", weekdays:[0,6], groupBy:["toPlace"], limit:10}`

詳しい仕様: プロジェクトの `docs/API.md` と `docs/API-reference.md`。
