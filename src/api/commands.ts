// API のコマンド定義。CLI・HTTP API・MCP サーバーはすべてここを使う
import { z } from 'zod';
import { aggregateLegs, aggregateTrips, LEG_GROUP_KEYS, TRIP_GROUP_KEYS } from '../core/aggregate';
import { filterLegs, filterTrips, FilterError, sortLegs, sortTrips, type Filter, type SortKey } from '../core/filter';
import { MODE_LABEL, MODES, type Mode } from '../core/types';
import { getEngine, iso, legFeature, legJSON, resolveStation, toCsv, tripJSON, type Engine } from './engine';

// ------------------------------------------------------------
// 入力の受け付け（JSON の値でも CLI の文字列でも通るようにする）
// ------------------------------------------------------------
const MODE_ALIASES: Record<string, Mode> = Object.fromEntries([
  ...MODES.map((m) => [m, m]),
  ...MODES.map((m) => [MODE_LABEL[m], m]),
  ['車', 'car'], ['バス', 'car'], ['bus', 'car'], ['鉄道', 'train'], ['地下鉄', 'train'], ['フェリー', 'ship'], ['ferry', 'ship'],
  ['bike', 'bicycle'], ['自転車', 'bicycle'], ['歩き', 'walk'],
]);
const WD: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const list = (v: unknown) => (typeof v === 'string' ? v.split(/[,、\s]+/).filter(Boolean) : v);
const num = z.coerce.number();
const bool = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください');

const modes = z.preprocess(
  (v) => (list(v) as unknown[] | undefined)?.map((x) => MODE_ALIASES[String(x).toLowerCase()] ?? MODE_ALIASES[String(x)] ?? x),
  z.array(z.enum(MODES as [Mode, ...Mode[]])),
);
const weekdays = z.preprocess(
  (v) => (list(v) as unknown[] | undefined)?.map((x) => (typeof x === 'number' ? x : WD[String(x).replace(/曜日?$/, '').toLowerCase().slice(0, 3)] ?? Number(x))),
  z.array(z.number().int().min(0).max(6)),
);
const near = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const [lat, lon, radiusM] = v.split(',').map(Number);
    return { lat, lon, radiusM: radiusM || 500 };
  },
  z.object({ lat: num, lon: num, radiusM: num.default(500) }),
);

export const filterShape = {
  dateFrom: date.optional().describe('この日以降（YYYY-MM-DD, JST）'),
  dateTo: date.optional().describe('この日以前（YYYY-MM-DD, JST）'),
  weekdays: weekdays.optional().describe('曜日。0=日…6=土 または "月,火" / "sat,sun"'),
  hourFrom: num.int().min(0).max(23).optional().describe('出発時刻の時の下限（0-23）。hourFrom > hourTo なら日付またぎ（例 22〜5）'),
  hourTo: num.int().min(0).max(23).optional().describe('出発時刻の時の上限（0-23、その時台を含む）'),
  from: z.string().optional().describe('乗車駅の名前（例: "新宿"。末尾の「駅」は不要）'),
  via: z.preprocess(list, z.array(z.string())).optional().describe('途中で通った駅（順序どおり。複数可）'),
  to: z.string().optional().describe('降車駅の名前'),
  strictEnds: bool.optional().describe('false にすると from/to を「通過」でも一致させる（既定 true: 乗車駅・降車駅のみ）'),
  modes: modes.optional().describe(`移動手段（複数可）: ${MODES.map((m) => `${m}=${MODE_LABEL[m]}`).join(', ')}`),
  line: z.string().optional().describe('路線名の部分一致（例: "環状線", "山手線"）'),
  operator: z.string().optional().describe('鉄道事業者名の部分一致（例: "東日本旅客鉄道", "近畿日本鉄道"）'),
  minKmh: num.optional().describe('区間の平均時速の下限 (km/h)'),
  maxKmh: num.optional().describe('区間の平均時速の上限 (km/h)'),
  minTopKmh: num.optional().describe('区間内の最高速度（95パーセンタイル）の下限 (km/h)'),
  minMinutes: num.optional().describe('区間の所要時間の下限（分）'),
  maxMinutes: num.optional().describe('区間の所要時間の上限（分）'),
  minKm: num.optional().describe('区間の距離の下限 (km)'),
  maxKm: num.optional().describe('区間の距離の上限 (km)'),
  inferred: bool.optional().describe('true: 記録の途切れを推定で補った区間のみ / false: 除外'),
  fromPlace: z.string().optional().describe('出発地の名前の部分一致（"home" で自宅）。places で名前を確認できる'),
  toPlace: z.string().optional().describe('到着地の名前の部分一致（"home" で自宅）'),
  near: near.optional().describe('この地点の近くを通った: {lat, lon, radiusM} または "35.681,139.767,300"'),
  prefecture: z.string().optional().describe('通過した都道府県（部分一致。例: "京都"）'),
  municipality: z.string().optional().describe('通過した市区町村（部分一致。例: "大阪市北区", "鎌倉市"）'),
};

const SORTS = ['start', '-start', 'distance', '-distance', 'duration', '-duration', 'speed', '-speed'] as const;
const paging = {
  sort: z.enum(SORTS).optional().describe('並び順。先頭に - で降順（既定 -start = 新しい順）'),
  limit: num.int().min(1).max(1000).optional().describe('返す件数（既定 20、最大 1000）'),
  offset: num.int().min(0).optional().describe('先頭から飛ばす件数（ページ送り）'),
};
const format = z.enum(['json', 'csv', 'geojson']).optional().describe('出力形式: json（既定）/ csv（表計算向け）/ geojson（地図向けの軌跡）');

type FilterInput = z.infer<z.ZodObject<typeof filterShape>>;

const NON_FILTER = new Set(['sort', 'limit', 'offset', 'detail', 'format', 'groupBy', 'unit', 'sortBy']);

function toFilter(e: Engine, i: FilterInput): Filter {
  const f = Object.fromEntries(Object.entries(i).filter(([k]) => !NON_FILTER.has(k))) as Filter;
  if (i.from) f.from = resolveStation(e, i.from);
  if (i.to) f.to = resolveStation(e, i.to);
  if (i.via) f.via = i.via.filter(Boolean).map((v) => resolveStation(e, v));
  return f;
}

/** 返した結果に付ける、条件の正規化結果（エージェントが確認できるように） */
const cleaned = (f: Filter) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));

// ------------------------------------------------------------
// コマンド
// ------------------------------------------------------------
export interface Command<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** 戻り値はそのまま JSON にする。文字列を返した場合（CSV など）はそのまま出力 */
  run: (e: Engine, input: z.infer<z.ZodObject<S>>) => unknown;
  /** 引数なしでも意味がある例（ドキュメント・ヘルプ用） */
  examples?: Record<string, unknown>[];
}

const def = <S extends z.ZodRawShape>(c: Command<S>) => c as unknown as Command;

export const COMMANDS: Command[] = [
  def({
    name: 'summary',
    title: '全体の概要',
    description: '記録期間、移動回数、移動手段ごとの合計、訪れた都道府県数、よく行く場所・よく乗る区間の上位などを返す。まず最初にこれを呼ぶと全体像がつかめる。',
    input: { dateFrom: filterShape.dateFrom, dateTo: filterShape.dateTo },
    run: (e, i) => {
      const f: Filter = { dateFrom: i.dateFrom, dateTo: i.dateTo };
      const legs = filterLegs(e.ctx, f);
      const trips = filterTrips(e.ctx, f);
      const top = (k: string, n = 8) => aggregateLegs(e.ctx, legs, [k]).slice(0, n).map((r) => ({ [k]: r.key[k], count: r.count, distanceKm: r.distanceKm }));
      const s = e.a.stats;
      const prefs = new Set(e.a.munis.map((m) => m.pref));
      return {
        period: { first: iso(s.firstT), last: iso(s.lastT), daysWithRecords: s.days },
        filter: cleaned(f),
        trips: trips.length,
        distanceKm: Math.round(trips.reduce((a, t) => a + t.trip.dist, 0) / 1000),
        byMode: aggregateLegs(e.ctx, legs, ['mode'], 'distance').map((r) => ({ mode: r.key.mode, legs: r.count, distanceKm: r.distanceKm, durationHours: r.durationHours, avgKmh: r.avgKmh })),
        topSections: top('section'),
        topLines: top('line'),
        topPlaces: [...e.a.places].sort((x, y) => y.totalMs - x.totalMs).slice(0, 8).map((p) => ({ id: p.id, name: e.ctx.placeLabel(p.id), municipality: p.muni, visits: p.visits, totalHours: Math.round(p.totalMs / 3600e3) })),
        visited: { prefectures: prefs.size, municipalities: e.a.munis.length },
        data: { files: e.files, rawRows: s.rawRows, trackPoints: s.trackPoints, analysisMs: e.ms },
      };
    },
  }),

  def({
    name: 'search_trips',
    title: '移動（トリップ）の検索',
    description:
      '滞在地から次の滞在地までの「1回の移動」を条件で検索する。駅の並び（from→via→to）、移動手段・速度・時間などの区間条件、日時・曜日・時間帯、出発地/到着地、通過エリアを組み合わせられる。区間条件は「どれか1つの区間が満たせば一致」。',
    input: { ...filterShape, ...paging, detail: z.enum(['summary', 'full']).optional().describe('summary（既定）: 一致した区間と乗り物の区間 / full: 徒歩も含む全区間'), format },
    examples: [
      { from: '新宿', to: '東京', limit: 5 },
      { modes: ['train'], minKmh: 60, minMinutes: 30 },
      { fromPlace: 'home', weekdays: '土,日', hourFrom: 22, hourTo: 4 },
    ],
    run: (e, i) => {
      const f = toFilter(e, i);
      const all = sortTrips(filterTrips(e.ctx, f), (i.sort ?? '-start') as SortKey);
      const off = i.offset ?? 0, lim = i.limit ?? 20;
      const page = all.slice(off, off + lim);
      if (i.format === 'geojson') {
        return { type: 'FeatureCollection', features: page.flatMap((m) => m.legs.map((li) => legFeature(e, m.trip, m.trip.legs[li], li))) };
      }
      if (i.format === 'csv') {
        return toCsv(page.map(({ trip, legs }) => {
          const t = tripJSON(e, trip, { legs });
          return { id: t.id, date: t.date, start: t.start, end: t.end, durationMin: t.durationMin, distanceKm: t.distanceKm, from: t.from, to: t.to, modes: t.modes.map((m) => MODE_LABEL[m as keyof typeof MODE_LABEL]), route: t.legs.filter((l) => l.board).map((l) => `${l.board}→${l.alight ?? '?'}`) };
        }));
      }
      return {
        filter: cleaned(f),
        total: all.length,
        offset: off,
        returned: page.length,
        totals: {
          distanceKm: Math.round(all.reduce((a, m) => a + m.trip.dist, 0) / 100) / 10,
          days: new Set(all.map((m) => m.trip.date)).size,
        },
        items: page.map((m) => tripJSON(e, m.trip, { legs: m.legs, detail: i.detail })),
      };
    },
  }),

  def({
    name: 'search_legs',
    title: '区間の検索',
    description:
      '「電車に乗っていた間」「車で走っていた間」のような区間単位で検索する。例: 時速80km以上で20分以上走った車の区間、新幹線の乗車、ある路線の乗車。駅条件は区間内の乗車駅・通過駅・降車駅で判定。',
    input: { ...filterShape, ...paging, format },
    examples: [
      { modes: 'car', minKmh: 80, minMinutes: 20, sort: '-speed' },
      { line: '山手線', dateFrom: '2025-01-01' },
    ],
    run: (e, i) => {
      const f = toFilter(e, i);
      const all = sortLegs(filterLegs(e.ctx, f), (i.sort ?? '-start') as SortKey);
      const off = i.offset ?? 0, lim = i.limit ?? 20;
      const page = all.slice(off, off + lim);
      if (i.format === 'geojson') return { type: 'FeatureCollection', features: page.map((m) => legFeature(e, m.trip, m.leg, m.index)) };
      const items = page.map((m) => ({ tripId: m.trip.id, date: m.trip.date, ...legJSON(e, m.leg, m.index) }));
      if (i.format === 'csv') return toCsv(items.map(({ via, ...rest }) => ({ ...rest, via })));
      return {
        filter: cleaned(f),
        total: all.length,
        offset: off,
        returned: page.length,
        totals: {
          distanceKm: Math.round(all.reduce((a, m) => a + m.leg.dist, 0) / 100) / 10,
          durationHours: Math.round(all.reduce((a, m) => a + (m.leg.end - m.leg.start), 0) / 360e3) / 10,
        },
        items,
      };
    },
  }),

  def({
    name: 'aggregate',
    title: '集計（グループ化）',
    description:
      `条件に合う移動を groupBy のキーでまとめて、回数・距離・時間・平均時速を返す。groupBy は最大3つ（例: ["month","mode"] で月別×手段別）。` +
      `unit=legs（既定）のキー: ${LEG_GROUP_KEYS.join(', ')}。unit=trips のキー: ${TRIP_GROUP_KEYS.join(', ')}。` +
      'station は通過駅も含めて数える。section は「乗車駅→降車駅」。',
    input: {
      ...filterShape,
      groupBy: z.preprocess(list, z.array(z.string()).max(3)).optional().describe('グループ化のキー（省略時は全体の合計1行）'),
      unit: z.enum(['legs', 'trips']).optional().describe('legs: 区間単位（既定） / trips: 移動単位'),
      sortBy: z.enum(['count', 'distance', 'duration', 'key']).optional().describe('並び順（既定 count の多い順。key は値の昇順で時系列に便利）'),
      limit: num.int().min(1).max(5000).optional().describe('返す行数（既定 100）'),
      format: z.enum(['json', 'csv']).optional().describe('json（既定）/ csv'),
    },
    examples: [
      { groupBy: ['month', 'mode'], sortBy: 'key' },
      { modes: 'train', groupBy: 'section', limit: 10 },
      { unit: 'trips', groupBy: 'route', fromPlace: 'home' },
    ],
    run: (e, i) => {
      const f = toFilter(e, i);
      const groupBy = i.groupBy ?? [];
      const rows = i.unit === 'trips'
        ? aggregateTrips(e.ctx, filterTrips(e.ctx, f), groupBy, i.sortBy)
        : aggregateLegs(e.ctx, filterLegs(e.ctx, f), groupBy, i.sortBy);
      const out = rows.slice(0, i.limit ?? 100);
      if (i.format === 'csv') return toCsv(out.map((r) => ({ ...r.key, count: r.count, distanceKm: r.distanceKm, durationHours: r.durationHours, avgKmh: r.avgKmh })));
      return { filter: cleaned(f), unit: i.unit ?? 'legs', groupBy, totalGroups: rows.length, rows: out };
    },
  }),

  def({
    name: 'day',
    title: '1日の記録',
    description: '指定した日の移動（全区間）と滞在を時刻順に返す。',
    input: { date: date.describe('日付（YYYY-MM-DD, JST）') },
    examples: [{ date: '2025-04-01' }],
    run: (e, i) => {
      const trips = e.a.trips.filter((t) => t.date === i.date);
      const t0 = Date.parse(`${i.date}T00:00:00+09:00`), t1 = t0 + 86400e3;
      const stays = e.a.stays.filter((s) => s.end > t0 && s.start < t1).map((s) => ({
        start: iso(s.start), end: iso(s.end), place: e.ctx.placeLabel(s.place), placeId: s.place, lat: s.lat, lon: s.lon,
      }));
      return {
        date: i.date,
        distanceKm: Math.round(trips.reduce((a, t) => a + t.dist, 0) / 100) / 10,
        trips: trips.map((t) => tripJSON(e, t, { detail: 'full' })),
        stays,
      };
    },
  }),

  def({
    name: 'trip',
    title: '移動の詳細',
    description: 'トリップ ID（search_trips の id）を指定して全区間の詳細を返す。track=true で軌跡（GeoJSON）も付ける。',
    input: {
      id: num.int().min(0).describe('トリップ ID'),
      track: bool.optional().describe('true で区間ごとの軌跡を GeoJSON で付ける'),
      maxPoints: num.int().min(10).max(20000).optional().describe('軌跡1区間あたりの最大点数（既定 2000）'),
    },
    run: (e, i) => {
      const t = e.a.trips[i.id];
      if (!t) throw new FilterError(`トリップ ${i.id} はありません（0〜${e.a.trips.length - 1}）`);
      return {
        ...tripJSON(e, t, { detail: 'full' }),
        ...(i.track ? { track: { type: 'FeatureCollection', features: t.legs.map((l, li) => legFeature(e, t, l, li, i.maxPoints)) } } : {}),
      };
    },
  }),

  def({
    name: 'places',
    title: '滞在した場所',
    description: '10分以上とどまった場所（滞在地）の一覧。名前・市区町村で絞り込み、滞在時間・回数・初訪問・最終訪問で並べ替え。',
    input: {
      query: z.string().optional().describe('名前・市区町村の部分一致'),
      sort: z.enum(['time', 'visits', 'first', '-first', 'last']).optional().describe('time=滞在時間（既定）, visits=回数, first=初訪問が新しい順, -first=古い順, last=最終訪問が新しい順'),
      firstFrom: date.optional().describe('初訪問がこの日以降の場所だけ（「初めて行った場所」を探す）'),
      limit: num.int().min(1).max(1000).optional().describe('既定 30'),
      offset: num.int().min(0).optional(),
    },
    run: (e, i) => {
      let ps = e.a.places.map((p) => ({ p, name: e.ctx.placeLabel(p.id) }));
      if (i.query) ps = ps.filter(({ p, name }) => name.includes(i.query!) || p.muni.includes(i.query!));
      if (i.firstFrom) { const t = Date.parse(`${i.firstFrom}T00:00:00+09:00`); ps = ps.filter(({ p }) => p.first >= t); }
      const key = { time: (x: (typeof ps)[0]) => -x.p.totalMs, visits: (x: (typeof ps)[0]) => -x.p.visits, first: (x: (typeof ps)[0]) => -x.p.first, '-first': (x: (typeof ps)[0]) => x.p.first, last: (x: (typeof ps)[0]) => -x.p.last }[i.sort ?? 'time'];
      ps.sort((x, y) => key(x) - key(y));
      const off = i.offset ?? 0;
      return {
        total: ps.length,
        items: ps.slice(off, off + (i.limit ?? 30)).map(({ p, name }) => ({
          id: p.id, name, autoName: p.autoName, municipality: p.muni, lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5,
          visits: p.visits, totalHours: Math.round((p.totalMs / 3600e3) * 10) / 10, firstVisit: iso(p.first), lastVisit: iso(p.last),
        })),
      };
    },
  }),

  def({
    name: 'place_visits',
    title: '場所の訪問履歴',
    description: '場所 ID（places の id）または名前で、その場所に滞在した日時の一覧を返す。',
    input: {
      id: num.int().min(0).optional().describe('場所 ID'),
      name: z.string().optional().describe('場所名の部分一致（id が無い場合。最も滞在時間が長い場所を使う）'),
      dateFrom: filterShape.dateFrom,
      dateTo: filterShape.dateTo,
      limit: num.int().min(1).max(5000).optional().describe('既定 100（新しい順）'),
    },
    run: (e, i) => {
      let id = i.id;
      if (id === undefined && i.name) {
        const hit = e.a.places.filter((p) => e.ctx.placeLabel(p.id).includes(i.name!) || (i.name === 'home' && p.id === e.ctx.homeId)).sort((x, y) => y.totalMs - x.totalMs)[0];
        id = hit?.id;
      }
      const p = id !== undefined ? e.a.places[id] : undefined;
      if (!p) throw new FilterError('場所が見つかりません。places で id を確認してください');
      const from = i.dateFrom ? Date.parse(`${i.dateFrom}T00:00:00+09:00`) : -Infinity;
      const to = i.dateTo ? Date.parse(`${i.dateTo}T00:00:00+09:00`) + 86400e3 : Infinity;
      const visits = e.a.stays.filter((s) => s.place === p.id && s.start >= from && s.start < to).reverse();
      return {
        place: { id: p.id, name: e.ctx.placeLabel(p.id), municipality: p.muni },
        total: visits.length,
        totalHours: Math.round(visits.reduce((a, s) => a + s.end - s.start, 0) / 360e3) / 10,
        items: visits.slice(0, i.limit ?? 100).map((s) => ({ start: iso(s.start), end: iso(s.end), hours: Math.round(((s.end - s.start) / 3600e3) * 10) / 10 })),
      };
    },
  }),

  def({
    name: 'municipalities',
    title: '訪れた市区町村',
    description: '通過・滞在した市区町村と都道府県（政令市は区単位）。都道府県ごとの制覇率、各市区町村の訪問日数と初訪問日。',
    input: {
      prefecture: z.string().optional().describe('都道府県の部分一致（指定すると市区町村の一覧も返す）'),
      unvisited: bool.optional().describe('true で、指定した都道府県のまだ行っていない市区町村も返す'),
    },
    run: (e, i) => {
      const visited = new Map(e.a.munis.map((m) => [m.code, m]));
      const byPref = new Map<string, { total: number; visited: number }>();
      for (const f of e.muniFeatures) {
        const x = byPref.get(f.properties.pref) ?? { total: 0, visited: 0 };
        x.total++;
        if (visited.has(f.properties.code)) x.visited++;
        byPref.set(f.properties.pref, x);
      }
      const prefs = [...byPref.entries()].filter(([, v]) => v.visited).map(([pref, v]) => ({ pref, visited: v.visited, total: v.total, rate: Math.round((v.visited / v.total) * 1000) / 10 })).sort((a, b) => b.rate - a.rate);
      const out: Record<string, unknown> = { prefectures: prefs.length, municipalities: visited.size, byPrefecture: prefs };
      if (i.prefecture) {
        const fs = e.muniFeatures.filter((f) => f.properties.pref.includes(i.prefecture!));
        out.list = fs.filter((f) => visited.has(f.properties.code)).map((f) => {
          const m = visited.get(f.properties.code)!;
          return { pref: m.pref, name: m.name, days: m.days, firstVisit: iso(m.first) };
        }).sort((a, b) => b.days - a.days);
        if (i.unvisited) out.unvisited = fs.filter((f) => !visited.has(f.properties.code)).map((f) => `${f.properties.pref}${f.properties.name}`);
      }
      return out;
    },
  }),

  def({
    name: 'stations',
    title: '駅の利用回数',
    description: '記録に登場した駅と、乗車・降車・通過の回数。駅名の表記を確かめるのにも使う（search_* の from/to/via に使える名前）。',
    input: {
      query: z.string().optional().describe('駅名の部分一致'),
      sort: z.enum(['total', 'board', 'alight', 'pass']).optional().describe('並び順（既定 total）'),
      limit: num.int().min(1).max(5000).optional().describe('既定 50'),
    },
    run: (e, i) => {
      let rows = [...e.stationUse.entries()].map(([name, u]) => ({ name, ...u, total: u.board + u.alight + u.pass }));
      if (i.query) rows = rows.filter((r) => r.name.includes(i.query!.replace(/駅$/, '')));
      const k = i.sort ?? 'total';
      rows.sort((a, b) => b[k] - a[k]);
      return { total: rows.length, items: rows.slice(0, i.limit ?? 50) };
    },
  }),
];

export function findCommand(name: string): Command | undefined {
  const n = name.replaceAll('-', '_');
  return COMMANDS.find((c) => c.name === n);
}

export class InputError extends Error {
  constructor(message: string, readonly issues: unknown) {
    super(message);
  }
}

/** 入力を検証してコマンドを実行する */
export function runCommand(name: string, input: Record<string, unknown>, opts: { dataDir?: string } = {}): unknown {
  const cmd = findCommand(name);
  if (!cmd) throw new InputError(`不明なコマンド: ${name}`, { commands: COMMANDS.map((c) => c.name) });
  const parsed = z.object(cmd.input).strict().safeParse(input);
  if (!parsed.success) {
    throw new InputError('引数が正しくありません', parsed.error.issues.map((x) => ({ param: x.path.join('.'), message: x.message })));
  }
  return cmd.run(getEngine({ dataDir: opts.dataDir }), parsed.data);
}

/** エラーを API の応答形式に */
export function errorBody(err: unknown) {
  if (err instanceof InputError) return { error: err.message, details: err.issues };
  if (err instanceof FilterError) return { error: err.message, ...(err.hint ? { details: err.hint } : {}) };
  return { error: err instanceof Error ? err.message : String(err) };
}

/** 各コマンドの引数の説明（ヘルプ・ドキュメント用） */
export function describeCommand(c: Command) {
  return {
    name: c.name,
    title: c.title,
    description: c.description,
    params: Object.fromEntries(Object.entries(c.input).map(([k, s]) => [k, (s as z.ZodType).description ?? ''])),
    ...(c.examples ? { examples: c.examples } : {}),
  };
}
