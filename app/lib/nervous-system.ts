import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  BY_ID,
  EDGES,
  NODES,
  edgeBlocked,
  edgeInfected,
  siteCompromised,
  type SiteNode,
} from './scenario';
import { offsetLngLat, pointAlong, pointInView, projectPath, ringLngLats, samplePath, type LngLat } from './geo';
import { smoothstep } from './motion';

const PAPER = { r: 243, g: 238, b: 228 };
const BLOOD = { r: 197, g: 18, b: 42 };
const INK = { r: 18, g: 16, b: 14 };

type RGB = { r: number; g: number; b: number };

function rgba(c: RGB, a: number) {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

type Packet = {
  edgeId: string;
  t: number;
  speed: number;
  trail: number[];
  pioneer: boolean;
};

type Ring = {
  lngLat: LngLat;
  born: number;
  hot: boolean;
};

type SimState = {
  stage: number;
  contained: boolean;
  blockStage: number;
  pressure: number;
  now: number;
  reduced: boolean;
};

function makeGlow(color: RGB) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return c;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, rgba(color, 0.95));
  grd.addColorStop(0.18, rgba(color, 0.45));
  grd.addColorStop(0.42, rgba(color, 0.12));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return c;
}

export class NervousSystem {
  packets: Packet[] = [];
  rings: Ring[] = [];
  edgeBorn = new Map<string, number>();
  nodeBorn = new Map<string, number>();
  pioneers = new Set<string>();
  spawnAcc = new Map<string, number>();
  glowPaper = makeGlow(PAPER);
  glowBlood = makeGlow(BLOOD);
  lastStage = -1;

  sync(state: SimState) {
    if (state.stage !== this.lastStage) {
      for (const node of NODES) {
        if (state.stage >= node.reveal && !this.nodeBorn.has(node.id)) {
          this.nodeBorn.set(node.id, state.now);
          if (node.kind !== 'load') {
            this.rings.push({ lngLat: node.lngLat, born: state.now, hot: siteCompromised(node, state.stage, state.contained, state.blockStage) });
          }
        }
      }
      for (const edge of EDGES) {
        if (state.stage >= edge.reveal && !this.edgeBorn.has(edge.id)) {
          this.edgeBorn.set(edge.id, state.now);
        }
      }
      this.lastStage = state.stage;
    }
  }

  tick(dt: number, state: SimState) {
    this.sync(state);
    if (state.reduced) {
      this.packets = [];
      return;
    }

    for (const edge of EDGES) {
      const infected = edgeInfected(edge, state.stage, state.contained, state.blockStage);
      const born = this.edgeBorn.get(edge.id);
      if (!infected || born === undefined) continue;
      const dest = BY_ID[edge.to];
      const isLoad = dest?.kind === 'load';
      const stagger = isLoad ? [...edge.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 800 : 0;
      const age = state.now - born;
      if (age < 1100 + stagger) continue;
      if (!this.pioneers.has(edge.id)) {
        this.pioneers.add(edge.id);
        this.packets.push({ edgeId: edge.id, t: 0, speed: isLoad ? 0.28 : 0.22, trail: [], pioneer: true });
      }
      const acc = (this.spawnAcc.get(edge.id) ?? 0) + dt;
      const interval = isLoad ? 0.9 : 0.48;
      if (acc > interval) {
        this.spawnAcc.set(edge.id, acc - interval);
        const live = this.packets.filter((p) => p.edgeId === edge.id && !p.pioneer).length;
        if (live < (isLoad ? 1 : 3)) {
          this.packets.push({ edgeId: edge.id, t: 0, speed: 0.34 + Math.random() * 0.12, trail: [], pioneer: false });
        }
      } else {
        this.spawnAcc.set(edge.id, acc);
      }
    }

    const next: Packet[] = [];
    for (const packet of this.packets) {
      const edge = EDGES.find((item) => item.id === packet.edgeId);
      if (!edge) continue;
      const infected = edgeInfected(edge, state.stage, state.contained, state.blockStage);
      const blocked = edgeBlocked(edge, state.stage, state.contained, state.blockStage);
      const cap = blocked ? 0.52 : 1;
      if (!infected && !blocked) continue;
      packet.t += packet.speed * dt;
      packet.trail.unshift(packet.t);
      if (packet.trail.length > 12) packet.trail.pop();
      if (packet.t >= cap) {
        if (blocked) {
          this.rings.push({ lngLat: lerpAlong(edge.from, edge.to, cap), born: state.now, hot: true });
        } else {
          const dest = BY_ID[edge.to];
          if (dest.kind !== 'load') this.rings.push({ lngLat: dest.lngLat, born: state.now, hot: true });
        }
        continue;
      }
      next.push(packet);
    }
    this.packets = next;
    this.rings = this.rings.filter((ring) => state.now - ring.born < 2200);
  }

  draw(ctx: CanvasRenderingContext2D, map: MapLibreMap, state: SimState) {
    const { width, height } = ctx.canvas;
    const dpr = width / map.getCanvas().clientWidth || 1;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = map.getCanvas().clientWidth;
    const h = map.getCanvas().clientHeight;
    const zoom = map.getZoom();
    if (zoom < 6.05) {
      ctx.restore();
      return;
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const edge of EDGES) {
      if (state.stage < edge.reveal) continue;
      const from = BY_ID[edge.from];
      const to = BY_ID[edge.to];
      const born = this.edgeBorn.get(edge.id) ?? state.now;
      const drawOn = state.reduced ? 1 : smoothstep(0, 1.15, (state.now - born) / 1150);
      const infected = edgeInfected(edge, state.stage, state.contained, state.blockStage);
      const blocked = edgeBlocked(edge, state.stage, state.contained, state.blockStage);
      const load = to.kind === 'load';
      const path = projectPath(map, samplePath(from.lngLat, to.lngLat, load ? 20 : 40));
      const color = infected ? BLOOD : PAPER;
      drawVein(ctx, path, drawOn, color, infected ? (load ? 0.55 : 1) : 0.45, state.now, blocked);
      if (blocked && (!load || to.labeled)) drawBreak(ctx, path, 0.52);
    }

    for (const packet of this.packets) {
      const edge = EDGES.find((item) => item.id === packet.edgeId);
      if (!edge) continue;
      const from = BY_ID[edge.from];
      const to = BY_ID[edge.to];
      const path = projectPath(map, samplePath(from.lngLat, to.lngLat, to.kind === 'load' ? 20 : 40));
      const trail = packet.trail.map((t) => pointAlong(path, t));
      if (trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
        ctx.strokeStyle = rgba(BLOOD, packet.pioneer ? 0.55 : 0.28);
        ctx.lineWidth = packet.pioneer ? 4.5 : 2.2;
        ctx.stroke();
      }
      const p = pointAlong(path, packet.t);
      const glow = packet.pioneer ? 52 : 34;
      ctx.drawImage(this.glowBlood, p.x - glow / 2, p.y - glow / 2, glow, glow);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.ty, p.tx));
      ctx.fillStyle = rgba(PAPER, 0.95);
      const len = packet.pioneer ? 18 : 11;
      ctx.fillRect(-len / 2, -1.15, len, 2.3);
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'source-over';
    for (const ring of this.rings) {
      const age = (state.now - ring.born) / 2200;
      if (age > 1) continue;
      const radius = 40 + age * 420;
      const pts = projectPath(map, ringLngLats(ring.lngLat, radius, 72));
      if (!pts.length) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.strokeStyle = rgba(ring.hot ? BLOOD : PAPER, (1 - age) * 0.55);
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    for (const node of NODES) {
      if (state.stage < node.reveal) continue;
      const p = map.project(node.lngLat);
      if (!pointInView(p, w, h, 120)) continue;
      const born = this.nodeBorn.get(node.id) ?? state.now;
      const appear = state.reduced ? 1 : smoothstep(0, 0.8, (state.now - born) / 800);
      const hot = siteCompromised(node, state.stage, state.contained, state.blockStage);
      const color = hot ? BLOOD : PAPER;
      const pulse = 0.72 + Math.sin(state.now * 0.003 + node.lngLat[0]) * 0.28;
      const glowSize = (node.kind === 'load' ? (hot ? 42 : 28) : hot ? 86 : 64) * appear * pulse;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (node.kind === 'load' ? 0.55 : 0.85) * appear;
      ctx.drawImage(hot ? this.glowBlood : this.glowPaper, p.x - glowSize / 2, p.y - glowSize / 2, glowSize, glowSize);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (node.kind !== 'load') drawGroundMark(ctx, map, node, color, appear, hot, state);
    }

    ctx.restore();
  }
}

function lerpAlong(fromId: string, toId: string, t: number): LngLat {
  return samplePath(BY_ID[fromId].lngLat, BY_ID[toId].lngLat, 20)[Math.round(t * 20)] ?? BY_ID[toId].lngLat;
}

function drawVein(
  ctx: CanvasRenderingContext2D,
  path: { x: number; y: number }[],
  drawOn: number,
  color: RGB,
  intensity: number,
  now: number,
  blocked: boolean,
) {
  if (path.length < 2) return;
  const n = Math.max(2, Math.floor((path.length - 1) * drawOn) + 1);
  const visible = path.slice(0, n);
  const pulse = 0.55 + Math.sin(now * 0.004) * 0.18;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(visible[0].x, visible[0].y);
  for (let i = 1; i < visible.length; i++) ctx.lineTo(visible[i].x, visible[i].y);
  ctx.strokeStyle = rgba(color, 0.14 * intensity * pulse);
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.32 * intensity);
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = rgba(mix(color, PAPER, blocked ? 0.45 : 0.12), 0.9 * intensity);
  ctx.lineWidth = 1.35;
  ctx.stroke();
}

function drawBreak(ctx: CanvasRenderingContext2D, path: { x: number; y: number }[], t: number) {
  const p = pointAlong(path, t);
  const nx = -p.ty;
  const ny = p.tx;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = rgba(PAPER, 0.95);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x + nx * 16, p.y + ny * 16);
  ctx.lineTo(p.x - nx * 16, p.y - ny * 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x + nx * 11 + p.tx * 4, p.y + ny * 11 + p.ty * 4);
  ctx.lineTo(p.x - nx * 11 + p.tx * 4, p.y - ny * 11 + p.ty * 4);
  ctx.stroke();
  ctx.restore();
}

function drawGroundMark(
  ctx: CanvasRenderingContext2D,
  map: MapLibreMap,
  node: SiteNode,
  color: RGB,
  appear: number,
  hot: boolean,
  state: SimState,
) {
  const half = 18 + (hot ? 6 : 0);
  const corners = [
    offsetLngLat(node.lngLat, -half, -half),
    offsetLngLat(node.lngLat, half, -half),
    offsetLngLat(node.lngLat, half, half),
    offsetLngLat(node.lngLat, -half, half),
  ].map((lngLat) => map.project(lngLat));
  ctx.save();
  ctx.globalAlpha = appear;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = rgba(INK, 0.35);
  ctx.fill();
  const c = map.project(node.lngLat);
  const tick = 7;
  ctx.beginPath();
  ctx.moveTo(c.x - tick, c.y);
  ctx.lineTo(c.x + tick, c.y);
  ctx.moveTo(c.x, c.y - tick);
  ctx.lineTo(c.x, c.y + tick);
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();
  const pitch = (map.getPitch() * Math.PI) / 180;
  const shaft = (hot ? 72 : 48) * appear * Math.max(0.35, Math.sin(pitch)) * Math.min(1.35, map.getZoom() / 10);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x, c.y - shaft);
  ctx.strokeStyle = rgba(color, hot ? 0.95 : 0.7);
  ctx.lineWidth = hot ? 2 : 1.25;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.x, c.y - shaft, hot ? 3.2 : 2.2, 0, Math.PI * 2);
  ctx.fillStyle = rgba(color, 0.95);
  ctx.fill();
  if (node.id === 'water') {
    const fill = Math.max(0.12, state.pressure / 62);
    ctx.beginPath();
    ctx.moveTo(corners[3].x, corners[3].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    const topLeft = {
      x: corners[3].x + (corners[0].x - corners[3].x) * fill,
      y: corners[3].y + (corners[0].y - corners[3].y) * fill,
    };
    const topRight = {
      x: corners[2].x + (corners[1].x - corners[2].x) * fill,
      y: corners[2].y + (corners[1].y - corners[2].y) * fill,
    };
    ctx.lineTo(topRight.x, topRight.y);
    ctx.lineTo(topLeft.x, topLeft.y);
    ctx.closePath();
    ctx.fillStyle = rgba(color, 0.28);
    ctx.fill();
  }
  ctx.restore();
}
