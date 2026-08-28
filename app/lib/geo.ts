import type { Map as MapLibreMap, PointLike } from 'maplibre-gl';

export type LngLat = [number, number];

export function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  const ax = (a[0] * Math.PI) / 180;
  const ay = (a[1] * Math.PI) / 180;
  const bx = (b[0] * Math.PI) / 180;
  const by = (b[1] * Math.PI) / 180;
  const x1 = Math.cos(ay) * Math.cos(ax);
  const y1 = Math.cos(ay) * Math.sin(ax);
  const z1 = Math.sin(ay);
  const x2 = Math.cos(by) * Math.cos(bx);
  const y2 = Math.cos(by) * Math.sin(bx);
  const z2 = Math.sin(by);
  const d = Math.acos(Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2)));
  if (d < 1e-6) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const s = Math.sin(d);
  const w1 = Math.sin((1 - t) * d) / s;
  const w2 = Math.sin(t * d) / s;
  const x = w1 * x1 + w2 * x2;
  const y = w1 * y1 + w2 * y2;
  const z = w1 * z1 + w2 * z2;
  return [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI];
}

export function offsetLngLat(lngLat: LngLat, eastMeters: number, northMeters: number): LngLat {
  const [lng, lat] = lngLat;
  const dLat = northMeters / 110540;
  const dLng = eastMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

export function samplePath(a: LngLat, b: LngLat, n = 48): LngLat[] {
  const pts: LngLat[] = [];
  for (let i = 0; i <= n; i++) pts.push(lerpLngLat(a, b, i / n));
  return pts;
}

export function ringLngLats(lngLat: LngLat, radiusMeters: number, n = 64): LngLat[] {
  const pts: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(offsetLngLat(lngLat, Math.cos(a) * radiusMeters, Math.sin(a) * radiusMeters));
  }
  return pts;
}

export function projectPath(map: MapLibreMap, path: LngLat[]): { x: number; y: number }[] {
  return path.map((lngLat) => {
    const p = map.project(lngLat);
    return { x: p.x, y: p.y };
  });
}

export function pointInView(p: { x: number; y: number }, w: number, h: number, pad = 80) {
  return p.x > -pad && p.y > -pad && p.x < w + pad && p.y < h + pad;
}

export function pathLength(pts: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

export function pointAlong(pts: { x: number; y: number }[], t: number): { x: number; y: number; tx: number; ty: number } {
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, tx: 1, ty: 0 };
  const total = pathLength(pts);
  let remain = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const seg = Math.hypot(dx, dy) || 1e-6;
    if (remain <= seg) {
      const u = remain / seg;
      return { x: pts[i - 1].x + dx * u, y: pts[i - 1].y + dy * u, tx: dx / seg, ty: dy / seg };
    }
    remain -= seg;
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const seg = Math.hypot(dx, dy) || 1;
  return { x: last.x, y: last.y, tx: dx / seg, ty: dy / seg };
}

export function projectToCss(map: MapLibreMap, lngLat: LngLat): PointLike {
  return map.project(lngLat);
}
