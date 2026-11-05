/* ==================================================================
   環景導覽共用程式（瀏覽頁 index.html 與編輯器 editor.html 共用）
   使用 Photo Sphere Viewer 5.15.1 與 Markers 外掛

   tour.json 結構：
   {
     "title": "導覽名稱",
     "cameraHeight": 1.5,              // 拍攝時鏡頭離地高度（公尺）
     "start": "場景 id",
     "areas": [
       { "id": "campus", "name": "校園巡禮", "start": "場景 id",
         "plan": { "image": "plans/campus.jpg", "imgW": 1200, "imgH": 800, "scale": 0.05 },  // 選填：平面底圖，scale = 每像素幾公尺
         "scenes": [
           { "id": "s1", "name": "校門口", "file": "panos/s1.jpg",
             "x": 12.5, "y": 30.2,       // 在平面圖上的位置（公尺），y 往上為正
             "heading": 90,              // 照片正中央朝向的方位（度），0 = 平面圖上方，順時針
             "view":  { "yaw": 0, "pitch": 0 },
             "links": [
               { "to": "s2" },                              // 自動：依兩點座標算出白圈
               { "to": "s9", "yaw": -98.5, "pitch": 5 }     // 手動：自己放的位置（跨區域、樓梯）
             ],
             "tags":  [ { "yaw": 10, "pitch": 5, "title": "標題", "text": "說明", "images": [] } ] }
         ] }
     ]
   }
   yaw 往右為正、pitch 往上為正，單位都是「度」。
================================================================== */

export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const norm180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
export const norm360 = (d) => ((d % 360) + 360) % 360;
export const round1 = (x) => Math.round(x * 10) / 10;
export const round2 = (x) => Math.round(x * 100) / 100;
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const FLOOR_LIMIT = -3;   // 手動白圈 pitch 低於這個角度就畫在地上
const RING_R = 0.42;             // 地上白圈半徑（公尺）
const CURSOR_R = 0.3;            // 滑鼠游標圈半徑

export const placed = (s) => !!s && Number.isFinite(s.x) && Number.isFinite(s.y);
export const isManual = (l) => Number.isFinite(l.yaw) && Number.isFinite(l.pitch);

/* ------------------------------------------------------------ 資料 */
export class Tour {
  constructor(data) {
    this.data = data;
    this.reindex();
  }
  reindex() {
    this.byId = new Map();
    this.areaById = new Map();
    for (const a of this.data.areas) for (const s of a.scenes) {
      this.byId.set(s.id, s);
      this.areaById.set(s.id, a);
    }
  }
  get H() { return Number(this.data.cameraHeight) || 1.5; }
  scene(id) { return this.byId.get(id); }
  areaOf(id) { return this.areaById.get(id); }
  areaStart(area) {
    return (area.start && this.areaOf(area.start) === area && this.scene(area.start)) || area.scenes[0] || null;
  }
  firstScene() {
    const s = this.scene(this.data.start);
    if (s) return s;
    for (const a of this.data.areas) {
      const t = this.areaStart(a);
      if (t) return t;
    }
    return null;
  }
}

/* ------------------------------------------------------------ 幾何 */
/* 平面圖上從 a 看向 (x, y) 的方位角（度，平面圖上方 = 0，順時針） */
export function bearing(a, x, y) {
  return deg(Math.atan2(x - a.x, y - a.y));
}

export function floorDistance(pitchDeg, H) {
  return Math.min(25, Math.max(0.5, H / Math.tan(rad(-pitchDeg))));
}

/* 連結在照片上的位置：手動白圈直接用 yaw/pitch，自動白圈依兩點座標計算 */
export function linkGeom(tour, scene, link) {
  if (isManual(link)) return { yaw: link.yaw, pitch: link.pitch, manual: true };
  const t = tour.scene(link.to);
  if (!t || !placed(scene) || !placed(t) || tour.areaOf(t.id) !== tour.areaOf(scene.id)) return null;
  const dist = Math.hypot(t.x - scene.x, t.y - scene.y);
  const b = bearing(scene, t.x, t.y);
  return {
    yaw: norm180(b - (scene.heading || 0)),
    pitch: -deg(Math.atan2(tour.H, Math.max(dist, 0.3))),
    dist,
    bearing: b,
    auto: true,
  };
}

/* 地上以 (yaw, pitch) 那一點為圓心、半徑 r 公尺的圓 → 照片上的多邊形 */
export function floorRing(yawDeg, pitchDeg, H, r = RING_R, n = 36) {
  const d = floorDistance(pitchDeg, H);
  const cx = d * Math.sin(rad(yawDeg));
  const cy = d * Math.cos(rad(yawDeg));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const px = cx + r * Math.cos(t);
    const py = cy + r * Math.sin(t);
    pts.push([Math.atan2(px, py), -Math.atan2(H, Math.hypot(px, py))]);
  }
  return pts;
}

/* ------------------------------------------------------------ 標記 */
/* 說明文字：[顯示文字](https://網址) 和直接寫的 https:// 網址都變成超連結（開新分頁） */
export function linkify(text) {
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[\x21-\x7e]+)/g;
  const a = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    if (m[2]) {
      out += a(m[2], m[1]);
    } else {
      const url = m[3].replace(/[.,;:!?'")\]]+$/, '');   // 句尾的標點不算網址
      out += a(url, url) + esc(m[3].slice(url.length));
    }
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}

/* YouTube 網址 → 影片 id（11 碼），看不懂就回傳 null */
export function youtubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : null;
}
/* 網址裡的 t=90、t=1m30s、start=90 → 秒數 */
function youtubeStart(url) {
  const m = String(url || '').match(/[?&#](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(\d+)?s?(?:&|$)/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}
export function youtubeEmbed(url) {
  const id = youtubeId(url);
  if (!id) return '';
  const start = youtubeStart(url);
  const src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${start ? '&start=' + start : ''}`;
  return `<div class="tag-video"><iframe src="${esc(src)}" title="YouTube 影片" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}

export function tagHtml(tag, resolve) {
  const video = youtubeEmbed(tag.video);
  const imgs = (tag.images || []).map((p) => `<img src="${esc(resolve(p))}" alt="">`).join('');
  const body = String(tag.text || '')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${linkify(p)}</p>`)
    .join('');
  return `<article class="tag-panel">${video}${imgs}<h2>${esc(tag.title)}</h2>${body}</article>`;
}

/* 直立圓圈裡箭頭的方向（度，0 = 往前、順時針）；沒設定就是往前 */
export function arrowStyle(link) {
  const a = Number(link && link.arrow);
  return Number.isFinite(a) && a % 360 !== 0 ? ` style="--arrow:${a}deg"` : '';
}

/* 回傳 null 表示這個連結目前畫不出來（例如自動白圈但還沒放到平面圖） */
export function linkMarker(tour, scene, link, i, selected = false) {
  const g = linkGeom(tour, scene, link);
  if (!g) return null;
  const t = tour.scene(link.to);
  const fromArea = tour.areaOf(scene.id);
  const toArea = t && tour.areaOf(t.id);
  const label = t ? '前往 ' + t.name + (toArea && toArea !== fromArea ? '（' + toArea.name + '）' : '') : '連結的場景不存在';
  const cls = (selected ? ' is-selected' : '') + (t ? '' : ' is-broken');
  const base = {
    id: 'link-' + i,
    tooltip: { content: esc(label), position: 'top center' },
    data: { type: 'link', index: i },
  };
  if (g.pitch <= FLOOR_LIMIT) {
    return { ...base, polygon: floorRing(g.yaw, g.pitch, tour.H), className: 'floor-ring' + cls, zIndex: 5 };
  }
  return {
    ...base,
    position: { yaw: rad(g.yaw), pitch: rad(g.pitch) },
    html: `<span class="go-ring"${arrowStyle(link)}></span>`,
    size: { width: 46, height: 46 },
    anchor: 'center center',
    className: 'go-marker' + cls,
    zIndex: 6,
  };
}

export function tagMarker(tag, i, { selected = false, content = null } = {}) {
  const m = {
    id: 'tag-' + i,
    position: { yaw: rad(tag.yaw), pitch: rad(tag.pitch) },
    html: '<span class="tag-dot"></span>',
    size: { width: 28, height: 28 },
    anchor: 'center center',
    className: 'tag-marker' + (selected ? ' is-selected' : ''),
    tooltip: { content: esc(tag.title || '（未命名標籤）'), position: 'top center' },
    data: { type: 'tag', index: i },
    zIndex: 20,
  };
  if (content) m.content = content;
  return m;
}

export function cursorMarker() {
  return {
    id: 'cursor',
    polygon: floorRing(0, -30, 1.5, CURSOR_R, 24),
    className: 'floor-cursor',
    opacity: 0,
    data: { type: 'cursor' },
    zIndex: 1,
  };
}

/* 到達 to 時要面向哪裡：
   自動白圈 → 延續行進方向；
   手動白圈 → 若 to 有連回 from 的白圈，就背對它；
   都沒有 → to 自己設定的進入視角。 */
export function arrivalPosition(tour, from, to, link) {
  if (link && link.arrive) return { yaw: rad(link.arrive.yaw || 0), pitch: rad(link.arrive.pitch || 0) };   // 這條路線指定的抵達方向
  if (to.fixedView) return viewOf(to);   // 這個場景一律用進入視角
  const g = from && link && linkGeom(tour, from, link);
  if (g && g.auto && Number.isFinite(to.heading)) {
    return { yaw: rad(norm180(g.bearing - to.heading)), pitch: rad(-4) };
  }
  const back = from && (to.links || []).find((l) => l.to === from.id);
  const bg = back && linkGeom(tour, to, back);
  if (bg) return { yaw: rad(norm180(bg.yaw + 180)), pitch: rad(-4) };
  return viewOf(to);
}

export function viewOf(scene) {
  const v = scene.view || { yaw: 0, pitch: 0 };
  return { yaw: rad(v.yaw || 0), pitch: rad(v.pitch || 0) };
}

/* ------------------------------------------------------------ 移動 */
export class Navigator {
  /**
   * @param o.viewer   Photo Sphere Viewer 實體
   * @param o.markers  Markers 外掛實體
   * @param o.tour     Tour
   * @param o.resolve  檔案路徑 → 網址
   * @param o.build    (scene) => 標記陣列
   * @param o.onChange (scene) => void
   */
  constructor(o) {
    Object.assign(this, o);
    this.current = null;
    this.busy = false;
  }

  refresh() {
    if (this.current) this.markers.setMarkers(this.build(this.current).filter(Boolean));
  }

  async show(scene, position, transition, zoom) {
    const opts = { position, caption: scene.name, transition, showLoader: true };
    if (zoom !== undefined) opts.zoom = zoom;
    await this.viewer.setPanorama(this.resolve(scene.file), opts);
    this.current = scene;
    this.refresh();
    this.onChange?.(scene);
    this.preload(scene);
  }

  preload(scene) {
    for (const l of scene.links || []) {
      const t = this.tour.scene(l.to);
      if (!t) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = this.resolve(t.file);
    }
  }

  /* 沿著連結走過去：先轉向、往前推近，再淡入下一張 */
  async walk(link) {
    const t = this.tour.scene(link.to);
    const g = this.current && linkGeom(this.tour, this.current, link);
    if (!t || !g || this.busy) return;
    this.busy = true;
    const from = this.current;
    try {
      const zoom = this.viewer.getZoomLevel();
      this.hideCursor();
      await this.viewer.animate({
        yaw: rad(g.yaw),
        pitch: rad(Math.max(-12, Math.min(8, g.pitch))),
        zoom: Math.min(100, zoom + 12),
        speed: 600,
      });
      this.markers.clearMarkers();
      await this.show(t, arrivalPosition(this.tour, from, t, link), { speed: 700, rotation: false, effect: 'fade' }, zoom);
      this.arrivedBy = { from: from.id, index: (from.links || []).indexOf(link) };   // 編輯器「設為進入視角」用
    } catch (e) {
      console.error(e);
      this.refresh();
    } finally {
      this.busy = false;
    }
  }

  /* 直接跳到某個場景（下拉選單、平面圖、網址），面向它的進入視角 */
  async jump(id) {
    const t = this.tour.scene(id);
    if (!t || this.busy) return;
    if (this.current && t.id === this.current.id) return;
    this.busy = true;
    try {
      const pos = viewOf(t);
      this.arrivedBy = null;
      this.markers.clearMarkers();
      await this.show(t, pos, { speed: 500, rotation: false, effect: 'black' });
    } catch (e) {
      console.error(e);
      this.refresh();
    } finally {
      this.busy = false;
    }
  }

  /* 點地面：找出那個方向最接近的連結 */
  linkToward(yawDeg, pitchDeg) {
    if (!this.current || pitchDeg > -2) return null;
    let best = null;
    for (const l of this.current.links || []) {
      if (!this.tour.scene(l.to)) continue;
      const g = linkGeom(this.tour, this.current, l);
      if (!g) continue;
      const dy = Math.abs(norm180(g.yaw - yawDeg));
      if (dy < 25 && (!best || dy < best.dy)) best = { l, dy };
    }
    return best && best.l;
  }

  /* 游標圈只更新自己（render = false），不然外掛會把打開中的說明面板整個重畫：捲動跳回頂端、影片被重新載入 */
  hideCursor() {
    if (this.cursorHidden) return;
    try {
      this.markers.updateMarker({ id: 'cursor', opacity: 0 }, false);
      this.cursorHidden = true;
      this.viewer.needsUpdate();
    } catch (e) { /* 沒有游標圈 */ }
  }

  /* 滑鼠在地面上移動時，顯示跟著走的圈（觸控裝置不顯示） */
  attachCursor(container, isEnabled = () => true) {
    let raf = 0;
    let last = null;
    container.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!this.current || this.busy || !last) return;
        if (!isEnabled()) { this.hideCursor(); return; }
        if (last.target?.closest?.('.psv-panel, .psv-navbar')) { this.hideCursor(); return; }
        const r = container.getBoundingClientRect();
        let pos;
        try {
          pos = this.viewer.dataHelper.viewerCoordsToSphericalCoords({ x: last.clientX - r.left, y: last.clientY - r.top });
        } catch (err) { return; }
        const p = pos && deg(pos.pitch);
        if (!pos || p > -4 || floorDistance(p, this.tour.H) > 12) { this.hideCursor(); return; }
        try {
          this.markers.updateMarker({ id: 'cursor', opacity: 1, polygon: floorRing(deg(pos.yaw), p, this.tour.H, CURSOR_R, 24) }, false);
          this.cursorHidden = false;
          this.viewer.needsUpdate();
        } catch (err) { /* 標記尚未建立 */ }
      });
    });
    container.addEventListener('pointerleave', () => this.hideCursor());
  }
}

/* 說明面板打開時，把會和它重疊的浮動元件（標題列、小地圖、工具列）暫時藏起來 */
export function keepClearOfPanel(viewer, root, getEls) {
  const update = () => {
    const panel = root.querySelector('.psv-panel');
    const open = !!panel && panel.classList.contains('psv-panel--open');
    const left = open ? root.getBoundingClientRect().right - panel.offsetWidth : Infinity;
    for (const el of getEls()) {
      if (!el) continue;
      el.classList.remove('under-panel');
      if (open && el.getBoundingClientRect().right > left - 4) el.classList.add('under-panel');
    }
  };
  const later = () => requestAnimationFrame(update);
  viewer.addEventListener('show-panel', later);
  viewer.addEventListener('hide-panel', later);
  root.addEventListener('pointerup', later);   // 拖曳調整面板寬度之後
  window.addEventListener('resize', update);
  return update;
}

/* ------------------------------------------------------------ 平面圖 */
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * 平面圖：座標單位是公尺，y 往上為正（畫面上方 = 方位 0 度）。
 * 瀏覽頁用來顯示小地圖，編輯器用來拖曳拍攝點、連線、設定比例尺。
 */
export class PlanView {
  constructor(svg, { tour, resolve = (p) => p, onNode = null, zoomable = false, labels = 'all', fitTo = 'points' } = {}) {
    this.fitMode = fitTo;   // 'points' = 對準拍攝點，'all' = 整張底圖
    this.svg = svg;
    this.tour = tour;
    this.resolve = resolve;
    this.onNode = onNode;
    this.labels = labels;
    this.area = null;
    this.current = null;
    this.viewYaw = 0;
    this.highlight = new Set();
    this.vb = null;
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    if (zoomable) this.enableZoom();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(svg);
    }
  }

  setArea(area) {
    if (area !== this.area) { this.area = area; this.vb = null; }
    this.render();
  }
  setCurrent(scene, yawDeg = this.viewYaw) {
    this.current = scene;
    this.viewYaw = yawDeg;
    this.drawCone();
  }
  setView(yawDeg) {
    this.viewYaw = yawDeg;
    this.drawCone();
  }

  /* 底圖在世界座標中的範圍 */
  imageRect() {
    const p = this.area?.plan;
    if (!p || !p.image || !p.imgW || !p.scale) return null;
    return { x: 0, y: 0, w: p.imgW * p.scale, h: p.imgH * p.scale };
  }
  bounds(mode = this.fitMode) {
    const pts = (this.area?.scenes || []).filter(placed);
    if (mode === 'points' && pts.length >= 2) {
      let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
      for (const s of pts) { a0 = Math.min(a0, s.x); b0 = Math.min(b0, s.y); a1 = Math.max(a1, s.x); b1 = Math.max(b1, s.y); }
      const m = Math.max(4, 0.12 * Math.max(a1 - a0, b1 - b0));
      return { x: a0 - m, y: b0 - m, w: Math.max(8, a1 - a0 + 2 * m), h: Math.max(6, b1 - b0 + 2 * m) };
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    const r = this.imageRect();
    if (r) { add(r.x, r.y); add(r.x + r.w, r.y + r.h); }
    for (const s of this.area?.scenes || []) if (placed(s)) add(s.x, s.y);
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 20, h: 12 };
    const m = Math.max(1.5, 0.08 * Math.max(x1 - x0, y1 - y0));
    x0 -= m; y0 -= m; x1 += m; y1 += m;
    return { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(3, y1 - y0) };
  }
  fit(mode) { if (mode) this.fitMode = mode; this.vb = null; this.render(); }

  /* 以世界座標 p 為中心縮放，k < 1 放大、k > 1 縮小 */
  zoomAt(p, k) {
    if (!this.area) return;
    const vb = this.vb || this.bounds();
    const w = Math.min(4000, Math.max(2, vb.w * k));
    const f = w / vb.w;
    this.vb = { x: p.x - (p.x - vb.x) * f, y: p.y - (p.y - vb.y) * f, w, h: vb.h * f };
    this.render();
  }
  zoomBy(k) {
    const vb = this.vb || this.bounds();
    this.zoomAt({ x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 }, k);
  }
  /* 拍攝點跑到畫面外時，把畫面移過去（不改縮放） */
  ensureVisible(s) {
    const vb = this.vb;
    if (!vb || !placed(s)) return;
    const mx = vb.w * 0.1, my = vb.h * 0.1;
    if (s.x < vb.x + mx || s.x > vb.x + vb.w - mx || s.y < vb.y + my || s.y > vb.y + vb.h - my) {
      this.vb = { ...vb, x: s.x - vb.w / 2, y: s.y - vb.h / 2 };
    }
  }

  /* 世界座標 (x, y) ↔ SVG 座標 (x, -y) */
  toWorld(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: -p.y };
  }
  unit() {
    const w = this.svg.clientWidth || 300;
    const h = this.svg.clientHeight || 200;
    const vb = this.vb || this.bounds();
    return Math.max(vb.w / w, vb.h / h);   // 每像素幾公尺
  }

  enableZoom() {
    const svg = this.svg;
    svg.style.touchAction = 'none';
    svg.addEventListener('wheel', (e) => {
      if (!this.area) return;
      e.preventDefault();
      this.zoomAt(this.toWorld(e.clientX, e.clientY), Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
    const pts = new Map();   // 目前按著的手指／滑鼠
    let pan = null, pinch = null;
    const quiet = () => { this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 0); };
    svg.addEventListener('pointerdown', (e) => {
      if (!this.area) return;
      const onBg = e.target === svg || e.target.closest('.pv-bg');
      if (!pts.size && !onBg) return;   // 第一指按在拍攝點上：交給點擊或拖曳
      if (this.panBlocked?.()) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 略過 */ }
      if (pts.size === 1) {
        pan = { x: e.clientX, y: e.clientY, vb: { ...(this.vb || this.bounds()) }, moved: false };
      } else if (pts.size === 2) {
        const [p, q] = [...pts.values()];
        pinch = { d: Math.hypot(p.x - q.x, p.y - q.y) || 1 };
        pan = null;
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        if (pts.size < 2) return;
        const [p, q] = [...pts.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
        this.zoomAt(this.toWorld((p.x + q.x) / 2, (p.y + q.y) / 2), pinch.d / d);
        pinch.d = d;
        return;
      }
      if (!pan) return;
      const u = this.unit();
      const dx = (e.clientX - pan.x) * u;
      const dy = (e.clientY - pan.y) * u;
      if (Math.abs(dx) + Math.abs(dy) > 2 * u) pan.moved = true;
      this.vb = { ...pan.vb, x: pan.vb.x - dx, y: pan.vb.y + dy };
      this.render();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* 已釋放 */ }
      if (pinch) {
        if (pts.size < 2) { pinch = null; pan = null; quiet(); }
        return;
      }
      if (pan && pan.moved) quiet();
      pan = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  render() {
    const svg = this.svg;
    svg.innerHTML = '';
    if (!this.area) return;
    const vb = this.vb || this.bounds();
    svg.setAttribute('viewBox', `${vb.x} ${-(vb.y + vb.h)} ${vb.w} ${vb.h}`);
    const u = this.unit();

    const bg = svgEl('g', { class: 'pv-bg' }, svg);
    svgEl('rect', { x: vb.x - vb.w, y: -(vb.y + vb.h) - vb.h, width: vb.w * 3, height: vb.h * 3, class: 'pv-backdrop' }, bg);
    const r = this.imageRect();
    if (r) {
      svgEl('image', { href: this.resolve(this.area.plan.image), x: r.x, y: -(r.y + r.h), width: r.w, height: r.h, preserveAspectRatio: 'none', class: 'pv-image' }, bg);
    } else {
      const step = vb.w > 80 ? 10 : vb.w > 30 ? 5 : 1;
      const g = svgEl('g', { class: 'pv-grid' }, bg);
      for (let x = Math.ceil(vb.x / step) * step; x <= vb.x + vb.w; x += step) svgEl('line', { x1: x, y1: -(vb.y + vb.h), x2: x, y2: -vb.y }, g);
      for (let y = Math.ceil(vb.y / step) * step; y <= vb.y + vb.h; y += step) svgEl('line', { x1: vb.x, y1: -y, x2: vb.x + vb.w, y2: -y }, g);
    }

    const links = svgEl('g', { class: 'pv-links' }, svg);
    const seen = new Set();
    for (const s of this.area.scenes) {
      if (!placed(s)) continue;
      for (const l of s.links || []) {
        const t = this.tour.scene(l.to);
        if (!placed(t) || this.tour.areaOf(t.id) !== this.area) continue;
        const key = [s.id, t.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const manual = isManual(l) && !(t.links || []).some((b) => b.to === s.id && !isManual(b));
        svgEl('line', { x1: s.x, y1: -s.y, x2: t.x, y2: -t.y, class: 'pv-link' + (manual ? ' manual' : ''), 'data-a': s.id, 'data-b': t.id }, links);
      }
    }

    this.coneLayer = svgEl('g', { class: 'pv-cone-layer' }, svg);
    this.extraLayer = svgEl('g', { class: 'pv-extra' }, svg);

    const nodes = svgEl('g', { class: 'pv-nodes' }, svg);
    for (const s of this.area.scenes) {
      if (!placed(s)) continue;
      const isCur = this.current && this.current.id === s.id;
      const g = svgEl('g', {
        class: 'pv-node' + (isCur ? ' here' : '') + (this.highlight.has(s.id) ? ' hl' : '') + (Number.isFinite(s.heading) ? '' : ' no-heading'),
        'data-id': s.id,
        transform: `translate(${s.x} ${-s.y})`,
        tabindex: '0',
        role: 'button',
        'aria-label': s.name,
      }, nodes);
      const title = svgEl('title', {}, g);
      title.textContent = s.name;
      svgEl('circle', { r: (isCur ? 8 : 6.5) * u, 'stroke-width': 2 * u }, g);
      if (this.labels === 'all' || (this.labels === 'current' && isCur)) {
        const t = svgEl('text', { y: -11 * u, 'font-size': 11.5 * u, 'stroke-width': 3 * u }, g);
        t.textContent = s.name;
      }
      if (this.onNode) {
        g.addEventListener('click', (e) => { if (!this.suppressClick) this.onNode(s, e); });
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.onNode(s, e); });
      }
    }
    this.drawCone();
    this.onRender?.();
  }

  drawCone() {
    if (!this.coneLayer) return;
    this.coneLayer.innerHTML = '';
    const s = this.current;
    if (!s || !placed(s) || this.tour.areaOf(s.id) !== this.area) return;
    const u = this.unit();
    const rr = 42 * u;
    const b = (Number.isFinite(s.heading) ? s.heading : 0) + this.viewYaw;
    const half = 32;
    const pt = (a) => [s.x + rr * Math.sin(rad(a)), -(s.y + rr * Math.cos(rad(a)))];
    const [x1, y1] = pt(b - half);
    const [x2, y2] = pt(b + half);
    svgEl('path', {
      d: `M${s.x} ${-s.y} L${x1} ${y1} A${rr} ${rr} 0 0 1 ${x2} ${y2} Z`,
      class: 'pv-cone' + (Number.isFinite(s.heading) ? '' : ' unknown'),
    }, this.coneLayer);
  }
}

/* ------------------------------------------------------------ Cardboard VR
   用官方 Stereo 外掛把畫面分成左右眼，另外處理：
   - 換場景時程式會「停止所有動作」，不讓它把 VR 和陀螺儀關掉
   - 點螢幕（Cardboard 的按鈕）＝ 選目前看著的白圈，不是離開
   - 白圈改用 3D 圖層，左右眼都看得到；注視 1.5 秒就走過去
   - 低頭看「離開 VR」1.5 秒、或離開全螢幕（返回鍵），就結束 */
const VR_DWELL = 1500;
const VR_HIT = rad(7);
const VR_EXIT_PITCH = rad(-80);
const vrTex = new Map();
function vrTexture(key, w, h, draw) {
  if (vrTex.has(key)) return vrTex.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const url = c.toDataURL('image/png');
  vrTex.set(key, url);
  return url;
}
function vrLabel(g, text, x, y, maxW, size = 38) {
  g.font = `700 ${size}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let t = String(text || '');
  if (g.measureText(t).width > maxW) {
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  g.strokeText(t, x, y);
  g.fillStyle = '#fff';
  g.fillText(t, x, y);
}
function vrRing(label, arrow) {
  return vrTexture(`ring|${label}|${arrow}`, 256, 320, (g, w) => {
    const cx = w / 2, cy = 118;
    g.shadowColor = 'rgba(0, 0, 0, 0.6)';
    g.shadowBlur = 10;
    g.beginPath();
    g.arc(cx, cy, 96, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.18)';
    g.fill();
    g.lineWidth = 14;
    g.strokeStyle = '#fff';
    g.stroke();
    g.save();
    g.translate(cx, cy);
    g.rotate(rad(arrow || 0));
    g.beginPath();
    g.moveTo(-34, 16);
    g.lineTo(0, -20);
    g.lineTo(34, 16);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
    g.shadowBlur = 0;
    vrLabel(g, label, cx, 282, w - 8);
  });
}
function vrExitPlate() {
  return vrTexture('exit', 320, 140, (g, w, h) => {
    g.fillStyle = 'rgba(20, 24, 22, 0.82)';
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    g.lineWidth = 6;
    g.beginPath();
    if (g.roundRect) g.roundRect(6, 6, w - 12, h - 12, 28); else g.rect(6, 6, w - 12, h - 12);
    g.fill();
    g.stroke();
    vrLabel(g, '離開 VR', w / 2, h / 2, w - 30, 52);
  });
}
/* 每支手機自己的 VR 設定（左右距離、畫面大小），存在瀏覽器裡 */
const VR_CFG_KEY = 'sssh-tour-vr';
function loadVrCfg() {
  try { return JSON.parse(localStorage.getItem(VR_CFG_KEY)) || {}; } catch (e) { return {}; }
}
function saveVrCfg(cfg) {
  try { localStorage.setItem(VR_CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 無痕模式等存不了 */ }
}
function angDist(a, b) {
  const c = Math.sin(a.pitch) * Math.sin(b.pitch) + Math.cos(a.pitch) * Math.cos(b.pitch) * Math.cos(a.yaw - b.yaw);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

export class CardboardVR {
  /**
   * @param o.viewer  Photo Sphere Viewer
   * @param o.markers Markers 外掛
   * @param o.gyro    Gyroscope 外掛
   * @param o.stereo  Stereo 外掛
   * @param o.nav     Navigator
   * @param o.tour    Tour
   */
  constructor(o) {
    Object.assign(this, o);
    this.on = false;
    this.targets = [];
    this.gaze = null;
    this.elapsed = 0;
    this.cool = 0;
    this.loop = this.loop.bind(this);
    const s0 = this.stereo.handleEvent.bind(this.stereo);
    this.stereo.handleEvent = (e) => {
      if (this.on && e.type === 'stop-all') return;
      if (this.on && e.type === 'click') { this.tap(); return; }
      s0(e);
    };
    const g0 = this.gyro.handleEvent.bind(this.gyro);
    this.gyro.handleEvent = (e) => {
      if (this.on && e.type === 'stop-all') return;
      g0(e);
    };
    this.stereo.addEventListener('stereo-updated', (e) => this.setOn(e.stereoEnabled));
    this.viewer.addEventListener('fullscreen', (e) => {
      if (this.on && !e.fullscreenEnabled) this.stereo.stop();
    });
    this.cfg = loadVrCfg();
    this.reticles = [25, 75].map((x) => {
      const el = document.createElement('div');
      el.className = 'vr-reticle';
      el.style.left = x + '%';
      el.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="14"/>'
        + '<circle class="fg" cx="20" cy="20" r="14" pathLength="100" stroke-dasharray="0 100"/><circle class="dot" cx="20" cy="20" r="3"/></svg>';
      this.viewer.container.appendChild(el);
      return el;
    });
    this.buildSetup();
  }

  /* 左右眼畫面的位置：兩個畫面中心相距 sep 像素（對準 Cardboard 的兩片鏡片） */
  layout() {
    const W = this.viewer.container.clientWidth || window.innerWidth;
    const H = this.viewer.container.clientHeight || window.innerHeight;
    const def = Math.round(W * 0.42);
    const sep = Math.round(Math.max(W * 0.25, Math.min(W * 0.6, this.cfg.sep || def)));
    const eyeW = Math.max(1, Math.min(sep, W - sep));
    return { W, H, sep, def, eyeW, cx: [W / 2 - sep / 2, W / 2 + sep / 2] };
  }

  /* 取代官方的左右眼繪圖：兩眼用同一個相機（全景照沒有立體深度，這樣不會重影），位置照 layout() */
  effect(renderer) {
    const vr = this;
    return {
      render(scene, camera) {
        const L = vr.layout();
        const aspect = camera.aspect;
        camera.aspect = L.eyeW / L.H;
        camera.updateProjectionMatrix();
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, L.W, L.H);
        renderer.clear();
        renderer.setScissorTest(true);
        for (const cx of L.cx) {
          const x = Math.round(cx - L.eyeW / 2);
          renderer.setScissor(x, 0, L.eyeW, L.H);
          renderer.setViewport(x, 0, L.eyeW, L.H);
          renderer.render(scene, camera);
        }
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, L.W, L.H);
        renderer.autoClear = autoClear;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      },
    };
  }

  /* 「⚙ 調整眼鏡」：拿出手機時調整左右距離和畫面大小 */
  buildSetup() {
    const c = this.viewer.container;
    const stop = (el) => {
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick', 'wheel']) {
        el.addEventListener(t, (e) => e.stopPropagation());
      }
    };
    this.gear = document.createElement('button');
    this.gear.type = 'button';
    this.gear.className = 'vr-gear';
    this.gear.textContent = '⚙ 調整眼鏡';
    this.gear.addEventListener('click', () => this.showSetup(this.setup.hidden));
    stop(this.gear);
    c.appendChild(this.gear);
    this.setup = document.createElement('div');
    this.setup.className = 'vr-setup';
    this.setup.hidden = true;
    this.setup.innerHTML = `
      <div class="row"><span class="lbl">左右距離</span><button type="button" data-k="sep" data-d="-4">−</button><b data-v="sep"></b><button type="button" data-k="sep" data-d="4">＋</button></div>
      <div class="row"><span class="lbl">畫面大小</span><button type="button" data-k="zoom" data-d="-5">−</button><b data-v="zoom"></b><button type="button" data-k="zoom" data-d="5">＋</button></div>
      <p>放進眼鏡看：兩個圓點重疊成一個、人物不重影就對了。兩個點分太開就按「左右距離 −」。</p>
      <div class="row"><button type="button" data-k="reset">預設</button><button type="button" data-k="done" class="ok">完成</button><button type="button" data-k="exit">離開 VR</button></div>`;
    this.setup.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = b.dataset.k, d = Number(b.dataset.d) || 0;
      if (k === 'sep') this.cfg.sep = this.layout().sep + d;
      else if (k === 'zoom') {
        this.cfg.zoom = Math.max(0, Math.min(100, Math.round(this.viewer.getZoomLevel()) + d));
        this.viewer.zoom(this.cfg.zoom);
      } else if (k === 'reset') {
        this.cfg = {};
        if (this.zoomBefore != null) this.viewer.zoom(this.zoomBefore);
      } else if (k === 'done') {
        this.showSetup(false);
        return;
      } else if (k === 'exit') {
        this.showSetup(false);
        this.stereo.stop();
        return;
      }
      saveVrCfg(this.cfg);
      this.viewer.needsUpdate();
      this.showSetup(true);
    });
    stop(this.setup);
    c.appendChild(this.setup);
  }

  showSetup(show) {
    this.setup.hidden = !show;
    if (!show) return;
    const L = this.layout();
    this.setup.querySelector('[data-v="sep"]').textContent = L.sep === L.def ? `${L.sep}（預設）` : String(L.sep);
    this.setup.querySelector('[data-v="zoom"]').textContent = String(Math.round(this.viewer.getZoomLevel()));
  }

  setOn(on) {
    this.on = on;
    document.body.classList.toggle('vr-on', on);
    this.viewer.container.classList.toggle('vr-active', on);
    this.gaze = null;
    this.elapsed = 0;
    this.last = 0;
    this.cool = performance.now() + 800;
    this.needRelease = true;
    this.progress(0, false);
    this.nav.hideCursor?.();
    if (on) {
      this.viewer.renderer.setCustomRenderer((r) => this.effect(r));
      this.zoomBefore = this.viewer.getZoomLevel();
      if (this.cfg.zoom != null) this.viewer.zoom(this.cfg.zoom);
    } else {
      this.showSetup(false);
      if (this.zoomBefore != null) this.viewer.zoom(this.zoomBefore);
    }
    this.nav.refresh();
    if (on) requestAnimationFrame(this.loop);
  }

  /* VR 裡的標記：白圈（3D 圖層＋目的地名稱）和正下方的「離開 VR」 */
  markersFor(scene) {
    const list = [];
    this.targets = [];
    (scene.links || []).forEach((l, i) => {
      const g = linkGeom(this.tour, scene, l);
      const t = this.tour.scene(l.to);
      if (!g || !t) return;
      const yaw = rad(g.yaw);
      const pitch = rad(Math.max(-45, Math.min(45, g.pitch)));
      const ta = this.tour.areaOf(t.id);
      const label = t.name + (ta && ta !== this.tour.areaOf(scene.id) ? `（${ta.name}）` : '');
      list.push({ id: 'vr-link-' + i, imageLayer: vrRing(label, Number(l.arrow) || 0), position: { yaw, pitch }, size: { width: 180, height: 225 }, data: { type: 'vr' } });
      this.targets.push({ kind: 'link', link: l, yaw, pitch });
    });
    const yaw = this.viewer.getPosition().yaw;
    this.exit = { kind: 'exit', yaw, pitch: VR_EXIT_PITCH };
    list.push({ id: 'vr-exit', imageLayer: vrExitPlate(), position: { yaw, pitch: VR_EXIT_PITCH }, size: { width: 280, height: 123 }, rotation: { pitch: -VR_EXIT_PITCH }, data: { type: 'vr' } });
    return list;
  }

  progress(p, hot) {
    for (const r of this.reticles) {
      r.querySelector('.fg').setAttribute('stroke-dasharray', `${Math.round(p * 100)} 100`);
      r.classList.toggle('hot', !!hot);
    }
  }

  loop(now) {
    if (!this.on) return;
    requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(100, now - this.last) : 0;
    this.last = now;
    const L = this.layout();
    this.reticles.forEach((r, i) => { const x = Math.round(L.cx[i]) + 'px'; if (r.style.left !== x) r.style.left = x; });
    const p = this.viewer.getPosition();
    /* 「離開 VR」跟著轉到面前的方向，低頭時字才是正的 */
    if (p.pitch > rad(-45) && this.exit && Math.abs(p.yaw - this.exit.yaw) > 0.05 && now - (this.exitT || 0) > 300) {
      this.exitT = now;
      this.exit.yaw = p.yaw;
      try {
        this.markers.updateMarker({ id: 'vr-exit', position: { yaw: p.yaw, pitch: VR_EXIT_PITCH } }, false);
        this.viewer.needsUpdate();
      } catch (e) { /* 還沒建立 */ }
    }
    let best = null;
    if (!this.nav.busy) {
      if (p.pitch < rad(-65)) {
        best = this.exit;
      } else {
        let bd = VR_HIT;
        for (const t of this.targets) {
          const d = angDist(p, t);
          if (d < bd) { bd = d; best = t; }
        }
      }
    }
    /* 剛進 VR 或剛抵達時，要先把視線移開白圈一次，才開始計時（避免一抵達就又自動走） */
    this.looking = best;
    if (this.needRelease) {
      if (!best && !this.nav.busy) this.needRelease = false;
      best = null;
    }
    if (now < this.cool) best = null;
    if (best !== this.gaze) {
      this.gaze = best;
      this.elapsed = 0;
    } else if (best) {
      this.elapsed += dt;
    }
    this.progress(best ? Math.min(1, this.elapsed / VR_DWELL) : 0, !!best);
    if (best && this.elapsed >= VR_DWELL) {
      this.gaze = null;
      this.elapsed = 0;
      this.act(best);
    }
  }

  /* Cardboard 的按鈕：立刻選目前看著的目標 */
  tap() {
    if (this.gaze || this.looking) {
      const t = this.gaze || this.looking;
      this.gaze = null;
      this.act(t);
    } else {
      this.viewer.notification.show({ content: '把中間的圓點對準白圈，看著約 1.5 秒就會走過去；低頭看「離開 VR」可以離開。', timeout: 3000 });
    }
  }

  act(t) {
    this.progress(0, false);
    if (t.kind === 'exit') this.stereo.stop();
    else this.walk(t.link);
  }

  /* VR 裡走過去：不轉動畫面（交給陀螺儀），淡入下一張，再把「現在看的方向」對到抵達方向 */
  async walk(link) {
    const nav = this.nav;
    const from = nav.current;
    const t = this.tour.scene(link.to);
    if (!from || !t || nav.busy) return;
    nav.busy = true;
    this.cool = performance.now() + 1000;
    try {
      const arrive = arrivalPosition(this.tour, from, t, link);
      this.markers.clearMarkers();
      await this.viewer.setPanorama(nav.resolve(t.file), { caption: t.name, transition: { speed: 600, rotation: false, effect: 'fade' }, showLoader: true });
      nav.current = t;
      nav.arrivedBy = { from: from.id, index: (from.links || []).indexOf(link) };
      this.face(arrive.yaw);
      nav.refresh();
      nav.onChange?.(t);
      nav.preload(t);
    } catch (e) {
      console.error(e);
      nav.refresh();
    } finally {
      nav.busy = false;
      this.cool = performance.now() + 800;
      this.needRelease = true;
    }
  }

  /* 讓手機目前朝的方向對到 yaw（和陀螺儀外掛開始時的做法相同） */
  face(yaw) {
    const p = this.viewer.getPosition();
    this.viewer.dynamics.position.setValue({ yaw, pitch: p.pitch });
    if (this.gyro.controls) this.gyro.controls.alphaOffset = 0;
    this.gyro.state.alphaOffset = null;
    this.viewer.needsUpdate();
  }
}

/* Photo Sphere Viewer 介面文字 */
export const LANG = {
  zoom: '縮放', zoomOut: '縮小', zoomIn: '放大', fullscreen: '全螢幕', close: '關閉',
  twoFingers: '請用兩指移動畫面', ctrlZoom: '按住 Ctrl 再捲動可縮放', loadError: '全景圖載入失敗',
  stereo: 'VR 眼鏡（Cardboard）', gyroscope: '陀螺儀',
  stereoNotification: '看著白圈約 1.5 秒就會走過去；低頭看「離開 VR」或按返回鍵可以離開。',
  pleaseRotate: '請把手機轉成橫向', tapToContinue: '（或點一下繼續）',
};
