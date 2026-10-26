# API リファレンス

> このファイルは `npm run docs:api` で `src/api/commands.ts` から自動生成しています。直接編集しないでください。
> 使い方の説明は [API.md](API.md) を参照。

| コマンド | 内容 |
|---|---|
| [`summary`](#summary) | 全体の概要 |
| [`search_trips`](#search_trips) | 移動（トリップ）の検索 |
| [`search_legs`](#search_legs) | 区間の検索 |
| [`aggregate`](#aggregate) | 集計（グループ化） |
| [`day`](#day) | 1日の記録 |
| [`trip`](#trip) | 移動の詳細 |
| [`places`](#places) | 滞在した場所 |
| [`place_visits`](#place_visits) | 場所の訪問履歴 |
| [`municipalities`](#municipalities) | 訪れた市区町村 |
| [`stations`](#stations) | 駅の利用回数 |

## summary

**全体の概要** — 記録期間、移動回数、移動手段ごとの合計、訪れた都道府県数、よく行く場所・よく乗る区間の上位などを返す。まず最初にこれを呼ぶと全体像がつかめる。

| 引数 | 型 | 説明 |
|---|---|---|
| `dateFrom` | string | この日以降（YYYY-MM-DD, JST） |
| `dateTo` | string | この日以前（YYYY-MM-DD, JST） |

## search_trips

**移動（トリップ）の検索** — 滞在地から次の滞在地までの「1回の移動」を条件で検索する。駅の並び（from→via→to）、移動手段・速度・時間などの区間条件、日時・曜日・時間帯、出発地/到着地、通過エリアを組み合わせられる。区間条件は「どれか1つの区間が満たせば一致」。

| 引数 | 型 | 説明 |
|---|---|---|
| `dateFrom` | string | この日以降（YYYY-MM-DD, JST） |
| `dateTo` | string | この日以前（YYYY-MM-DD, JST） |
| `weekdays` | integer[] | 曜日。0=日…6=土 または "月,火" / "sat,sun" |
| `hourFrom` | integer | 出発時刻の時の下限（0-23）。hourFrom > hourTo なら日付またぎ（例 22〜5） |
| `hourTo` | integer | 出発時刻の時の上限（0-23、その時台を含む） |
| `from` | string | 乗車駅の名前（例: "新宿"。末尾の「駅」は不要） |
| `via` | string[] | 途中で通った駅（順序どおり。複数可） |
| `to` | string | 降車駅の名前 |
| `strictEnds` | boolean | false にすると from/to を「通過」でも一致させる（既定 true: 乗車駅・降車駅のみ） |
| `modes` | `walk` / `bicycle` / `car` / `train` / `shinkansen` / `ship` / `plane` / `unknown`[] | 移動手段（複数可）: walk=徒歩, bicycle=自転車, car=車・バス, train=電車, shinkansen=新幹線, ship=船, plane=飛行機, unknown=不明 |
| `line` | string | 路線名の部分一致（例: "環状線", "山手線"） |
| `operator` | string | 鉄道事業者名の部分一致（例: "東日本旅客鉄道", "近畿日本鉄道"） |
| `minKmh` | number | 区間の平均時速の下限 (km/h) |
| `maxKmh` | number | 区間の平均時速の上限 (km/h) |
| `minTopKmh` | number | 区間内の最高速度（95パーセンタイル）の下限 (km/h) |
| `minMinutes` | number | 区間の所要時間の下限（分） |
| `maxMinutes` | number | 区間の所要時間の上限（分） |
| `minKm` | number | 区間の距離の下限 (km) |
| `maxKm` | number | 区間の距離の上限 (km) |
| `inferred` | boolean | true: 記録の途切れを推定で補った区間のみ / false: 除外 |
| `fromPlace` | string | 出発地の名前の部分一致（"home" で自宅）。places で名前を確認できる |
| `toPlace` | string | 到着地の名前の部分一致（"home" で自宅） |
| `near` | { lat: number, lon: number, radiusM: number } | この地点の近くを通った: {lat, lon, radiusM} または "35.681,139.767,300" |
| `prefecture` | string | 通過した都道府県（部分一致。例: "京都"） |
| `municipality` | string | 通過した市区町村（部分一致。例: "大阪市北区", "鎌倉市"） |
| `sort` | `start` / `-start` / `distance` / `-distance` / `duration` / `-duration` / `speed` / `-speed` | 並び順。先頭に - で降順（既定 -start = 新しい順） |
| `limit` | integer | 返す件数（既定 20、最大 1000） |
| `offset` | integer | 先頭から飛ばす件数（ページ送り） |
| `detail` | `summary` / `full` | summary（既定）: 一致した区間と乗り物の区間 / full: 徒歩も含む全区間 |
| `format` | `json` / `csv` / `geojson` | 出力形式: json（既定）/ csv（表計算向け）/ geojson（地図向けの軌跡） |

例:

```bash
./bin/ashiato search_trips --from 新宿 --to 東京 --limit 5
./bin/ashiato search_trips --modes train --min-kmh 60 --min-minutes 30
./bin/ashiato search_trips --from-place home --weekdays 土,日 --hour-from 22 --hour-to 4
```

## search_legs

**区間の検索** — 「電車に乗っていた間」「車で走っていた間」のような区間単位で検索する。例: 時速80km以上で20分以上走った車の区間、新幹線の乗車、ある路線の乗車。駅条件は区間内の乗車駅・通過駅・降車駅で判定。

| 引数 | 型 | 説明 |
|---|---|---|
| `dateFrom` | string | この日以降（YYYY-MM-DD, JST） |
| `dateTo` | string | この日以前（YYYY-MM-DD, JST） |
| `weekdays` | integer[] | 曜日。0=日…6=土 または "月,火" / "sat,sun" |
| `hourFrom` | integer | 出発時刻の時の下限（0-23）。hourFrom > hourTo なら日付またぎ（例 22〜5） |
| `hourTo` | integer | 出発時刻の時の上限（0-23、その時台を含む） |
| `from` | string | 乗車駅の名前（例: "新宿"。末尾の「駅」は不要） |
| `via` | string[] | 途中で通った駅（順序どおり。複数可） |
| `to` | string | 降車駅の名前 |
| `strictEnds` | boolean | false にすると from/to を「通過」でも一致させる（既定 true: 乗車駅・降車駅のみ） |
| `modes` | `walk` / `bicycle` / `car` / `train` / `shinkansen` / `ship` / `plane` / `unknown`[] | 移動手段（複数可）: walk=徒歩, bicycle=自転車, car=車・バス, train=電車, shinkansen=新幹線, ship=船, plane=飛行機, unknown=不明 |
| `line` | string | 路線名の部分一致（例: "環状線", "山手線"） |
| `operator` | string | 鉄道事業者名の部分一致（例: "東日本旅客鉄道", "近畿日本鉄道"） |
| `minKmh` | number | 区間の平均時速の下限 (km/h) |
| `maxKmh` | number | 区間の平均時速の上限 (km/h) |
| `minTopKmh` | number | 区間内の最高速度（95パーセンタイル）の下限 (km/h) |
| `minMinutes` | number | 区間の所要時間の下限（分） |
| `maxMinutes` | number | 区間の所要時間の上限（分） |
| `minKm` | number | 区間の距離の下限 (km) |
| `maxKm` | number | 区間の距離の上限 (km) |
| `inferred` | boolean | true: 記録の途切れを推定で補った区間のみ / false: 除外 |
| `fromPlace` | string | 出発地の名前の部分一致（"home" で自宅）。places で名前を確認できる |
| `toPlace` | string | 到着地の名前の部分一致（"home" で自宅） |
| `near` | { lat: number, lon: number, radiusM: number } | この地点の近くを通った: {lat, lon, radiusM} または "35.681,139.767,300" |
| `prefecture` | string | 通過した都道府県（部分一致。例: "京都"） |
| `municipality` | string | 通過した市区町村（部分一致。例: "大阪市北区", "鎌倉市"） |
| `sort` | `start` / `-start` / `distance` / `-distance` / `duration` / `-duration` / `speed` / `-speed` | 並び順。先頭に - で降順（既定 -start = 新しい順） |
| `limit` | integer | 返す件数（既定 20、最大 1000） |
| `offset` | integer | 先頭から飛ばす件数（ページ送り） |
| `format` | `json` / `csv` / `geojson` | 出力形式: json（既定）/ csv（表計算向け）/ geojson（地図向けの軌跡） |

例:

```bash
./bin/ashiato search_legs --modes car --min-kmh 80 --min-minutes 20 --sort -speed
./bin/ashiato search_legs --line 山手線 --date-from 2025-01-01
```

## aggregate

**集計（グループ化）** — 条件に合う移動を groupBy のキーでまとめて、回数・距離・時間・平均時速を返す。groupBy は最大3つ（例: ["month","mode"] で月別×手段別）。unit=legs（既定）のキー: mode, year, month, date, weekday, hour, line, operator, board, alight, station, section, fromPlace, toPlace。unit=trips のキー: year, month, date, weekday, hour, fromPlace, toPlace, route, mainMode。station は通過駅も含めて数える。section は「乗車駅→降車駅」。

| 引数 | 型 | 説明 |
|---|---|---|
| `dateFrom` | string | この日以降（YYYY-MM-DD, JST） |
| `dateTo` | string | この日以前（YYYY-MM-DD, JST） |
| `weekdays` | integer[] | 曜日。0=日…6=土 または "月,火" / "sat,sun" |
| `hourFrom` | integer | 出発時刻の時の下限（0-23）。hourFrom > hourTo なら日付またぎ（例 22〜5） |
| `hourTo` | integer | 出発時刻の時の上限（0-23、その時台を含む） |
| `from` | string | 乗車駅の名前（例: "新宿"。末尾の「駅」は不要） |
| `via` | string[] | 途中で通った駅（順序どおり。複数可） |
| `to` | string | 降車駅の名前 |
| `strictEnds` | boolean | false にすると from/to を「通過」でも一致させる（既定 true: 乗車駅・降車駅のみ） |
| `modes` | `walk` / `bicycle` / `car` / `train` / `shinkansen` / `ship` / `plane` / `unknown`[] | 移動手段（複数可）: walk=徒歩, bicycle=自転車, car=車・バス, train=電車, shinkansen=新幹線, ship=船, plane=飛行機, unknown=不明 |
| `line` | string | 路線名の部分一致（例: "環状線", "山手線"） |
| `operator` | string | 鉄道事業者名の部分一致（例: "東日本旅客鉄道", "近畿日本鉄道"） |
| `minKmh` | number | 区間の平均時速の下限 (km/h) |
| `maxKmh` | number | 区間の平均時速の上限 (km/h) |
| `minTopKmh` | number | 区間内の最高速度（95パーセンタイル）の下限 (km/h) |
| `minMinutes` | number | 区間の所要時間の下限（分） |
| `maxMinutes` | number | 区間の所要時間の上限（分） |
| `minKm` | number | 区間の距離の下限 (km) |
| `maxKm` | number | 区間の距離の上限 (km) |
| `inferred` | boolean | true: 記録の途切れを推定で補った区間のみ / false: 除外 |
| `fromPlace` | string | 出発地の名前の部分一致（"home" で自宅）。places で名前を確認できる |
| `toPlace` | string | 到着地の名前の部分一致（"home" で自宅） |
| `near` | { lat: number, lon: number, radiusM: number } | この地点の近くを通った: {lat, lon, radiusM} または "35.681,139.767,300" |
| `prefecture` | string | 通過した都道府県（部分一致。例: "京都"） |
| `municipality` | string | 通過した市区町村（部分一致。例: "大阪市北区", "鎌倉市"） |
| `groupBy` | string[] | グループ化のキー（省略時は全体の合計1行） |
| `unit` | `legs` / `trips` | legs: 区間単位（既定） / trips: 移動単位 |
| `sortBy` | `count` / `distance` / `duration` / `key` | 並び順（既定 count の多い順。key は値の昇順で時系列に便利） |
| `limit` | integer | 返す行数（既定 100） |
| `format` | `json` / `csv` | json（既定）/ csv |

例:

```bash
./bin/ashiato aggregate --group-by month,mode --sort-by key
./bin/ashiato aggregate --modes train --group-by section --limit 10
./bin/ashiato aggregate --unit trips --group-by route --from-place home
```

## day

**1日の記録** — 指定した日の移動（全区間）と滞在を時刻順に返す。

| 引数 | 型 | 説明 |
|---|---|---|
| `date`（必須） | string | 日付（YYYY-MM-DD, JST） |

例:

```bash
./bin/ashiato day --date 2025-04-01
```

## trip

**移動の詳細** — トリップ ID（search_trips の id）を指定して全区間の詳細を返す。track=true で軌跡（GeoJSON）も付ける。

| 引数 | 型 | 説明 |
|---|---|---|
| `id`（必須） | integer | トリップ ID |
| `track` | boolean | true で区間ごとの軌跡を GeoJSON で付ける |
| `maxPoints` | integer | 軌跡1区間あたりの最大点数（既定 2000） |

## places

**滞在した場所** — 10分以上とどまった場所（滞在地）の一覧。名前・市区町村で絞り込み、滞在時間・回数・初訪問・最終訪問で並べ替え。

| 引数 | 型 | 説明 |
|---|---|---|
| `query` | string | 名前・市区町村の部分一致 |
| `sort` | `time` / `visits` / `first` / `-first` / `last` | time=滞在時間（既定）, visits=回数, first=初訪問が新しい順, -first=古い順, last=最終訪問が新しい順 |
| `firstFrom` | string | 初訪問がこの日以降の場所だけ（「初めて行った場所」を探す） |
| `limit` | integer | 既定 30 |
| `offset` | integer |  |

## place_visits

**場所の訪問履歴** — 場所 ID（places の id）または名前で、その場所に滞在した日時の一覧を返す。

| 引数 | 型 | 説明 |
|---|---|---|
| `id` | integer | 場所 ID |
| `name` | string | 場所名の部分一致（id が無い場合。最も滞在時間が長い場所を使う） |
| `dateFrom` | string | この日以降（YYYY-MM-DD, JST） |
| `dateTo` | string | この日以前（YYYY-MM-DD, JST） |
| `limit` | integer | 既定 100（新しい順） |

## municipalities

**訪れた市区町村** — 通過・滞在した市区町村と都道府県（政令市は区単位）。都道府県ごとの制覇率、各市区町村の訪問日数と初訪問日。

| 引数 | 型 | 説明 |
|---|---|---|
| `prefecture` | string | 都道府県の部分一致（指定すると市区町村の一覧も返す） |
| `unvisited` | boolean | true で、指定した都道府県のまだ行っていない市区町村も返す |

## stations

**駅の利用回数** — 記録に登場した駅と、乗車・降車・通過の回数。駅名の表記を確かめるのにも使う（search_* の from/to/via に使える名前）。

| 引数 | 型 | 説明 |
|---|---|---|
| `query` | string | 駅名の部分一致 |
| `sort` | `total` / `board` / `alight` / `pass` | 並び順（既定 total） |
| `limit` | integer | 既定 50 |
