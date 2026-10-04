import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Analysis, Mode, Trip } from '../core/types';
import { cssColor, MODE_COLOR_VAR, MODE_ORDER } from './format';

type FC = GeoJSON.FeatureCollection;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExpressionSpecification = any;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

export type LayerGroup = 'all' | 'heat' | 'day' | 'sel' | 'results' | 'places' | 'munis';

const GROUP_LAYERS: Record<LayerGroup, string[]> = {
  all: ['all-lines'],
  heat: ['heat'],
  day: ['day-lines', 'day-lines-inferred', 'stays'],
  sel: ['sel-casing', 'sel-lines', 'sel-lines-inferred', 'sel-stations'],
  results: ['res-lines'],
  places: ['places'],
  munis: ['munis-fill', 'munis-line'],
};

const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function modeColorExpr(): ExpressionSpecification {
  const e: unknown[] = ['match', ['get', 'm']];
  for (const m of MODE_ORDER) e.push(m, cssColor(MODE_COLOR_VAR[m]));
  e.push('#888');
  return e as ExpressionSpecification;
}

export function dateNum(key: string) {
  return Number(key.replaceAll('-', ''));
}

/** トリップの各区間を LineString に */
export function tripFeatures(a: Analysis, trip: Trip, legFilter?: number[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  trip.legs.forEach((l, li) => {
    if (legFilter && !legFilter.includes(li)) return;
    const coords: [number, number][] = [];
    for (let k = l.i0; k <= l.i1; k++) coords.push([a.pts.lon[k], a.pts.lat[k]]);
    if (coords.length < 2) return;
    out.push({
      type: 'Feature',
      properties: { m: l.mode, trip: trip.id, leg: li, inf: l.inferred ? 1 : 0, d: dateNum(trip.date) },
      geometry: { type: 'LineString', coordinates: coords },
    });
  });
  return out;
}

export function boundsOf(a: Analysis, trips: Trip[]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of trips) for (const l of t.legs) for (let k = l.i0; k <= l.i1; k++) {
    const x = a.pts.lon[k], y = a.pts.lat[k];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

export class MapCtl {
  map: maplibregl.Map;
  private ready: Promise<void>;
  private markers: maplibregl.Marker[] = [];
  private stayMarkers: maplibregl.Marker[] = [];
  onPickTrip?: (tripId: number) => void;
  onPickPlace?: (placeId: number) => void;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          gsi: {
            type: 'raster',
            tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 18,
            attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
          },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#e9eef2' } },
          { id: 'gsi', type: 'raster', source: 'gsi' },
        ],
      },
      center: [137.5, 36.5],
      zoom: 4.5,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    this.ready = new Promise((res) => this.map.on('load', () => { this.setup(); res(); }));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
  }

  private setup() {
    const m = this.map;
    for (const id of ['all', 'heatpts', 'day', 'stays', 'sel', 'sel-st', 'res', 'places', 'munis']) {
      m.addSource(id, { type: 'geojson', data: EMPTY });
    }
    const width: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2.5, 16, 4];
    m.addLayer({
      id: 'munis-fill', type: 'fill', source: 'munis',
      paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.75 },
    });
    m.addLayer({ id: 'munis-line', type: 'line', source: 'munis', paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.5 } });
    m.addLayer({
      id: 'heat', type: 'heatmap', source: 'heatpts',
      paint: {
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 10, 16, 20],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 14, 1.2],
        'heatmap-opacity': 0.85,
      },
    });
    m.addLayer({ id: 'all-lines', type: 'line', source: 'all', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width, 'line-opacity': 0.55 } });
    m.addLayer({ id: 'res-lines', type: 'line', source: 'res', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': width, 'line-opacity': 0.7 } });
    m.addLayer({ id: 'day-lines', type: 'line', source: 'day', filter: ['==', ['get', 'inf'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 14, 4], 'line-opacity': 0.75 } });
    m.addLayer({ id: 'day-lines-inferred', type: 'line', source: 'day', filter: ['==', ['get', 'inf'], 1], paint: { 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'sel-casing', type: 'line', source: 'sel', filter: ['==', ['get', 'inf'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 5, 14, 9], 'line-color': '#ffffff' } });
    m.addLayer({ id: 'sel-lines', type: 'line', source: 'sel', filter: ['==', ['get', 'inf'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 14, 6] } });
    m.addLayer({ id: 'sel-lines-inferred', type: 'line', source: 'sel', filter: ['==', ['get', 'inf'], 1], paint: { 'line-width': 3, 'line-dasharray': [1.5, 1.5] } });
    m.addLayer({ id: 'sel-stations', type: 'circle', source: 'sel-st', paint: { 'circle-radius': ['case', ['==', ['get', 'end'], 1], 6, 3.5], 'circle-color': '#ffffff', 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'stays', type: 'circle', source: 'stays', paint: { 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    m.addLayer({
      id: 'places', type: 'circle', source: 'places',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'h']], 0, 4, 10, 8, 60, 18],
        'circle-opacity': 0.75,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
    });
    this.applyTheme();

    for (const layer of ['all-lines', 'res-lines', 'day-lines', 'day-lines-inferred']) {
      m.on('click', layer, (e) => {
        const f = e.features?.[0];
        if (f) this.onPickTrip?.(Number(f.properties.trip));
      });
      m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
    }
    m.on('click', 'places', (e) => {
      const f = e.features?.[0];
      if (f) this.onPickPlace?.(Number(f.properties.id));
    });
    m.on('mouseenter', 'places', () => (m.getCanvas().style.cursor = 'pointer'));
    m.on('mouseleave', 'places', () => (m.getCanvas().style.cursor = ''));
  }

  private applyTheme() {
    const m = this.map;
    if (!m.getLayer('gsi')) return;
    const d = dark();
    // ダークモードでは淡色地図を反転して暗くする
    m.setPaintProperty('gsi', 'raster-brightness-min', d ? 0.92 : 0);
    m.setPaintProperty('gsi', 'raster-brightness-max', d ? 0.12 : 1);
    m.setPaintProperty('gsi', 'raster-hue-rotate', d ? 180 : 0);
    m.setPaintProperty('gsi', 'raster-saturation', d ? -0.4 : 0);
    m.setPaintProperty('bg', 'background-color', d ? '#1b1d20' : '#e9eef2');
    const c = modeColorExpr();
    for (const l of ['all-lines', 'res-lines', 'day-lines', 'day-lines-inferred', 'sel-lines', 'sel-lines-inferred']) m.setPaintProperty(l, 'line-color', c);
    m.setPaintProperty('munis-line', 'line-color', cssColor('var(--surface-1)'));
    m.setPaintProperty('sel-casing', 'line-color', d ? '#1a1a19' : '#ffffff');
    m.setPaintProperty('sel-stations', 'circle-stroke-color', cssColor('var(--text-primary)'));
    m.setPaintProperty('sel-stations', 'circle-color', cssColor('var(--surface-1)'));
    m.setPaintProperty('stays', 'circle-color', cssColor('var(--text-primary)'));
    m.setPaintProperty('places', 'circle-color', cssColor('var(--accent)'));
    m.setPaintProperty('heat', 'heatmap-color', [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(0,0,0,0)',
      0.15, cssColor('var(--seq-2)'),
      0.4, cssColor('var(--seq-3)'),
      0.7, cssColor('var(--seq-5)'),
      1, d ? '#cde2fb' : '#0d366b',
    ]);
  }

  async whenReady() {
    await this.ready;
  }

  async setData(source: string, data: FC) {
    await this.ready;
    (this.map.getSource(source) as GeoJSONSource).setData(data);
  }

  async show(groups: LayerGroup[]) {
    await this.ready;
    for (const [g, layers] of Object.entries(GROUP_LAYERS)) {
      const vis = groups.includes(g as LayerGroup) ? 'visible' : 'none';
      for (const l of layers) this.map.setLayoutProperty(l, 'visibility', vis);
    }
    if (!groups.includes('sel')) this.clearMarkers();
    if (!groups.includes('day')) this.setStayLabels([]);
  }

  async filterAll(from: string | undefined, to: string | undefined, modes: Mode[]) {
    await this.ready;
    const f: unknown[] = ['all'];
    if (from) f.push(['>=', ['get', 'd'], dateNum(from)]);
    if (to) f.push(['<=', ['get', 'd'], dateNum(to)]);
    this.map.setFilter('heat', [...f] as ExpressionSpecification);
    f.push(['in', ['get', 'm'], ['literal', modes]]);
    this.map.setFilter('all-lines', f as ExpressionSpecification);
  }

  fit(b: [number, number, number, number] | null, maxZoom = 15) {
    if (!b) return;
    const [x0, y0, x1, y1] = b;
    const narrow = this.map.getContainer().clientWidth < 500;
    this.map.fitBounds([[x0, y0], [x1, y1]], { padding: narrow ? 30 : 60, maxZoom, duration: 600 });
  }

  flyTo(lon: number, lat: number, zoom = 15) {
    this.map.flyTo({ center: [lon, lat], zoom, duration: 800 });
  }

  clearMarkers() {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
  }

  /** 駅名などのラベル（HTML マーカー。日本語フォントの配信が不要） */
  setLabels(labels: { lon: number; lat: number; text: string; cls?: string }[]) {
    this.clearMarkers();
    for (const l of labels) {
      const el = document.createElement('div');
      el.className = l.cls ?? 'st-label';
      el.textContent = l.text;
      this.markers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([l.lon, l.lat]).addTo(this.map));
    }
  }

  setStayLabels(labels: { lon: number; lat: number; text: string }[]) {
    this.stayMarkers.forEach((m) => m.remove());
    this.stayMarkers = labels.map((l) => {
      const el = document.createElement('div');
      el.className = 'stay-label';
      el.textContent = l.text;
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([l.lon, l.lat]).addTo(this.map);
    });
  }

  resize() {
    this.map.resize();
  }
}
