import type { MapDefinition } from '../map/tilemap';
import type { NpcLevel } from '../race/npcDriver';
import type { Rival } from '../race/rivals';
import type { CarPreview } from '../render/carPreview';
import type { VehiclePreset } from '../sim/vehicle';
import { carStats, driveOf } from './carStats';
import { COURSE_NOTES, type CourseProfile, courseProfile, profilePath } from './courseInfo';
import { type DetailView, escapeHtml } from './menu';

/** メニューの右側の説明（コース・車・ライバルなど）を作る */

const KIND_LABEL: Record<CourseProfile['kind'], string> = { loop: '周回', oneway: '一本道', roundtrip: '往復', free: 'フリー走行' };

/** 10 個の区切りの棒（ゲームの性能表のような） */
function bar(value: number): string {
  const lit = Math.max(1, Math.round(value * 10));
  return `<span class="bar" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i${i < lit ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

function statRows(rows: readonly { label: string; value: number; text?: string }[]): string {
  return `<div class="d-stats">${rows
    .map((r) => `<div class="stat"><span class="k">${escapeHtml(r.label)}</span>${bar(r.value)}<span class="v">${r.text ? escapeHtml(r.text) : ''}</span></div>`)
    .join('')}</div>`;
}

function specs(rows: readonly [string, string][]): string {
  return `<dl class="d-specs">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

/** canvas を、置いた枠の大きさ（と画面の解像度）に合わせる */
function fitCanvas(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number; ratio: number } | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const g = canvas.getContext('2d');
  if (!g || w < 2 || h < 2) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { g, w, h, ratio };
}

/** 高さを色にする（低い所は青緑、高い所は橙） */
function heightColor(t: number): string {
  const hue = 190 - 170 * Math.min(1, Math.max(0, t));
  return `hsl(${hue}, 85%, 58%)`;
}

/** 上から見たコースの形を描く（高さで色を変え、スタートに印を付ける） */
function drawCourseMap(canvas: HTMLCanvasElement, def: MapDefinition): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { g, w, h } = fit;
  g.clearRect(0, 0, w, h);
  const profile = courseProfile(def);
  if (profile.kind === 'free') {
    // タイルの街: 道路・建物・木・水をマス目で描く
    const rows = def.layout;
    const cols = Math.max(...rows.map((r) => r.length));
    const cell = Math.min((w - 16) / cols, (h - 16) / rows.length);
    const ox = (w - cell * cols) / 2;
    const oy = (h - cell * rows.length) / 2;
    const colors: Record<string, string> = { R: '#d8d6cf', c: '#ff8a3d', B: '#5b6270', T: '#3f7a4a', '~': '#2f6fa0', '=': '#d8d6cf', '#': '#8a8f99' };
    rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        const color = colors[ch];
        if (!color) return;
        g.fillStyle = color;
        const inset = ch === 'B' || ch === 'T' ? cell * 0.18 : 0;
        g.fillRect(ox + i * cell + inset, oy + j * cell + inset, cell - inset * 2 + 0.5, cell - inset * 2 + 0.5);
      }),
    );
    const s = def.start;
    g.fillStyle = '#ff4a1c';
    g.beginPath();
    g.arc(ox + (s.col + 0.5) * cell, oy + (s.row + 0.5) * cell, Math.max(3, cell * 0.22), 0, Math.PI * 2);
    g.fill();
    return;
  }
  const pts = profile.outline;
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const spanX = Math.max(...xs) - minX || 1;
  const spanZ = Math.max(...zs) - minZ || 1;
  const pad = 18;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanZ * scale) / 2;
  // ゲームの地図と同じ向き（上から見て、x は右、z は下）
  const at = (p: { x: number; z: number }): [number, number] => [ox + (p.x - minX) * scale, oy + (p.z - minZ) * scale];
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(...at(p)) : g.moveTo(...at(p))));
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.lineWidth = 9;
  g.stroke();
  const { heights } = profile;
  const minH = Math.min(...heights);
  const spanH = Math.max(1, Math.max(...heights) - minH);
  g.lineWidth = 4;
  for (let i = 1; i < pts.length; i++) {
    const hi = heights[Math.round(((i - 0.5) / (pts.length - 1)) * (heights.length - 1))];
    g.strokeStyle = profile.rise < 3 ? '#e9e6dc' : heightColor((hi - minH) / spanH);
    g.beginPath();
    g.moveTo(...at(pts[i - 1]));
    g.lineTo(...at(pts[i]));
    g.stroke();
  }
  // スタート（往復・周回はゴールも同じ所）
  const [sx, sy] = at(pts[0]);
  g.fillStyle = '#fff';
  g.strokeStyle = '#ff4a1c';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(sx, sy, 5.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  if (profile.kind === 'oneway') {
    const [gx, gy] = at(pts[pts.length - 1]);
    g.fillStyle = '#ff4a1c';
    g.fillRect(gx - 5, gy - 5, 10, 10);
  }
}

/** 高低差のグラフを描く */
function drawProfile(canvas: HTMLCanvasElement, def: MapDefinition): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { g, w, h } = fit;
  const profile = courseProfile(def);
  g.clearRect(0, 0, w, h);
  // 目盛りの横線
  g.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, Math.round((h * i) / 4) + 0.5);
    g.lineTo(w, Math.round((h * i) / 4) + 0.5);
    g.stroke();
  }
  const pts = profilePath(profile.heights, w, h, 6);
  if (!pts.length) return;
  const fill = g.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(255, 74, 28, 0.45)');
  fill.addColorStop(1, 'rgba(255, 74, 28, 0)');
  g.beginPath();
  g.moveTo(pts[0].x, h);
  for (const p of pts) g.lineTo(p.x, p.y);
  g.lineTo(pts[pts.length - 1].x, h);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.strokeStyle = '#ff6a3d';
  g.lineWidth = 2;
  g.stroke();
}

const km = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;

/** コースの説明: 上から見た形・高低差のグラフ・全長など・おすすめの車 */
export function courseDetail(def: MapDefinition, carLabel: (id: string) => string, extra?: { badge?: string; note?: string }): DetailView {
  const p = courseProfile(def);
  const note = COURSE_NOTES[def.id];
  const kind = p.kind === 'loop' ? `周回 ${p.laps}周` : KIND_LABEL[p.kind];
  const rows: [string, string][] =
    p.kind === 'free'
      ? [
          ['種類', kind],
          ['道幅', `${def.roadWidth} m`],
        ]
      : [
          ['全長', p.kind === 'loop' ? `${km(p.length)} / 周` : km(p.length)],
          ['高低差', `${Math.round(p.rise)} m`],
          ['最大勾配', `${p.maxGrade.toFixed(1)} %`],
          ['道幅', Math.abs(p.width.max - p.width.min) < 0.5 ? `${p.width.max.toFixed(0)} m` : `${p.width.min.toFixed(1)}〜${p.width.max.toFixed(0)} m`],
        ];
  const html = `<div class="d-course">
    <div class="d-hero d-map"><canvas class="course-map"></canvas><span class="d-tag">${escapeHtml(kind)}</span>${
      extra?.badge ? `<span class="d-tag hot">${escapeHtml(extra.badge)}</span>` : ''
    }</div>
    <div class="d-body">
      <h2 class="d-name">${escapeHtml(def.name)}</h2>
      ${note ? `<p class="d-text">${escapeHtml(note.text)}</p>` : ''}
      ${specs(rows)}
      ${p.kind === 'free' ? '' : `<div class="d-profile"><span class="d-label">ELEVATION</span><canvas class="course-profile"></canvas></div>`}
      ${p.features.length ? `<div class="d-features">${p.features.map((f) => `<span>${escapeHtml(f)}</span>`).join('')}</div>` : ''}
      ${note?.cars.length ? `<p class="d-reco"><span class="d-label">おすすめ</span>${note.cars.map((c) => escapeHtml(carLabel(c))).join(' / ')}</p>` : ''}
      ${extra?.note ? `<p class="d-note">${escapeHtml(extra.note)}</p>` : ''}
    </div>
  </div>`;
  return {
    html,
    mount: (root) => {
      const map = root.querySelector<HTMLCanvasElement>('.course-map');
      const profile = root.querySelector<HTMLCanvasElement>('.course-profile');
      const draw = () => {
        if (map) drawCourseMap(map, def);
        if (profile) drawProfile(profile, def);
      };
      draw();
      const observer = new ResizeObserver(draw);
      if (map) observer.observe(map);
      return () => observer.disconnect();
    },
  };
}

/** 車の説明: 回る車の見た目と性能 */
export function carDetail(car: VehiclePreset, preview: CarPreview): DetailView {
  const drive = driveOf(car);
  const text = drive ? car.description.slice(drive.length + 1) : car.description;
  return {
    html: `<div class="d-car">
      <div class="d-hero d-stage"><div class="preview-slot"></div>${drive ? `<span class="d-tag">${escapeHtml(drive)}</span>` : ''}</div>
      <div class="d-body">
        <h2 class="d-name">${escapeHtml(car.label)}</h2>
        <p class="d-text">${escapeHtml(text)}</p>
        ${statRows(carStats(car))}
      </div>
    </div>`,
    mount: (root) => {
      const slot = root.querySelector<HTMLElement>('.preview-slot');
      if (slot) preview.show(slot, car.id);
      return () => preview.hide();
    },
  };
}

/** NPC やライバルの強さを棒で出す */
function levelRows(level: NpcLevel): string {
  return statRows([
    { label: 'コーナー', value: (level.grip - 0.5) / 0.5 },
    { label: 'ブレーキ', value: (level.brake - 0.45) / 0.55 },
    { label: 'ライン取り', value: level.line },
    { label: '最高速', value: (level.topSpeed - 0.7) / 0.3 },
  ]);
}

const LEVEL_STARS: Record<string, number> = { easy: 1, normal: 2, hard: 3, pro: 4, legend: 5 };

function stars(level: NpcLevel): string {
  const n = LEVEL_STARS[level.id] ?? 3;
  return `<span class="stars" aria-label="${n} / 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
}

/** 写真のない人の代わりの絵（名前の頭文字） */
function portrait(name: string, photo: string | undefined): string {
  if (photo) return `<img class="photo" src="${escapeHtml(import.meta.env.BASE_URL + photo)}" alt="${escapeHtml(name)}" />`;
  return `<div class="photo none" aria-hidden="true"><span>${escapeHtml([...name][0] ?? '?')}</span></div>`;
}

/** ライバルの説明: 写真・チーム・車・得意なコース・強さ */
export function rivalDetail(rival: Rival, level: NpcLevel, info: { car: string; course: string; beaten: boolean }, preview: CarPreview): DetailView {
  return {
    html: `<div class="d-rival">
      <div class="d-portrait">${portrait(rival.name, rival.photo)}${info.beaten ? '<span class="d-tag hot">WIN</span>' : ''}</div>
      <div class="d-body">
        <p class="d-team">${escapeHtml(rival.team)}</p>
        <h2 class="d-name">${escapeHtml(rival.name)}</h2>
        <p class="d-level">${stars(level)}<span>${escapeHtml(level.label)}</span></p>
        ${specs([
          ['マシン', info.car],
          ['ホーム', info.course],
        ])}
        ${levelRows(level)}
        <div class="d-garage"><div class="preview-slot"></div></div>
      </div>
    </div>`,
    mount: (root) => {
      const slot = root.querySelector<HTMLElement>('.preview-slot');
      if (slot) preview.show(slot, rival.car);
      return () => preview.hide();
    },
  };
}

/** 時間帯と天気の説明: 空の色の絵（雨なら雨粒、霧なら白くかすむ） */
export function conditionsDetail(time: { id: string; label: string }, weather: { id: string; label: string }, specRows: readonly [string, string][]): DetailView {
  const lines: Record<string, string> = {
    clear: '乾いた路面。タイヤのグリップは本来の強さです。',
    rain: '雨の日はタイヤが滑りやすく、ブレーキも効きにくくなります。',
    fog: '霧で先が見えにくくなります。コーナーの位置は地図で確かめて。',
  };
  return {
    html: `<div class="d-course">
      <div class="d-hero d-sky sky-${escapeHtml(time.id)} wx-${escapeHtml(weather.id)}"><span class="d-tag">${escapeHtml(time.label)} / ${escapeHtml(weather.label)}</span><div class="ridge"></div></div>
      <div class="d-body">
        <p class="d-team">CONDITIONS</p>
        <h2 class="d-name">${escapeHtml(time.label)}・${escapeHtml(weather.label)}</h2>
        <p class="d-text">${escapeHtml(lines[weather.id] ?? '')}</p>
        ${specs(specRows)}
      </div>
    </div>`,
  };
}

/** NPC の強さの説明 */
export function npcDetail(level: NpcLevel, count: number): DetailView {
  return {
    html: `<div class="d-plain">
      <div class="d-body">
        <p class="d-team">NPC × ${count}</p>
        <h2 class="d-name">${escapeHtml(level.label)}</h2>
        <p class="d-level">${stars(level)}</p>
        ${levelRows(level)}
        <p class="d-text">NPC は前に並び、自分は最後尾からスタート。</p>
      </div>
    </div>`,
  };
}

/** 文だけの説明（ルール・時間帯と天気・プレイモードなど） */
export function textDetail(opts: { kicker?: string; title: string; lines: readonly string[]; specs?: readonly [string, string][]; big?: string }): DetailView {
  return {
    html: `<div class="d-plain">
      ${opts.big ? `<div class="d-big" aria-hidden="true">${escapeHtml(opts.big)}</div>` : ''}
      <div class="d-body">
        ${opts.kicker ? `<p class="d-team">${escapeHtml(opts.kicker)}</p>` : ''}
        <h2 class="d-name">${escapeHtml(opts.title)}</h2>
        ${opts.lines.map((l) => `<p class="d-text">${escapeHtml(l)}</p>`).join('')}
        ${opts.specs?.length ? specs(opts.specs) : ''}
      </div>
    </div>`,
  };
}
