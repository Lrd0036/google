import type { CameraShot } from './scenario';
import { SATELLITE_TILE_TEMPLATE } from './map-style';

const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const PRELOAD_RADIUS = 1;
const PRELOAD_ZOOM_OFFSETS = [-1, 0] as const;

type TilePriority = 'high' | 'low';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function tileCoordinate(center: [number, number], zoom: number) {
  const tilesAtZoom = 2 ** zoom;
  const longitude = ((center[0] + 180) % 360 + 360) % 360 - 180;
  const latitude = clamp(center[1], -WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_LATITUDE);
  const latitudeRadians = latitude * Math.PI / 180;
  return {
    x: Math.floor(((longitude + 180) / 360) * tilesAtZoom),
    y: Math.floor(
      (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * tilesAtZoom,
    ),
  };
}

export function satelliteTileUrlsForShot(shot: CameraShot) {
  const urls = new Set<string>();
  const targetZoom = Math.floor(shot.zoom);

  for (const zoomOffset of PRELOAD_ZOOM_OFFSETS) {
    const zoom = Math.max(0, targetZoom + zoomOffset);
    const tilesAtZoom = 2 ** zoom;
    const center = tileCoordinate(shot.center, zoom);

    for (let yOffset = -PRELOAD_RADIUS; yOffset <= PRELOAD_RADIUS; yOffset += 1) {
      for (let xOffset = -PRELOAD_RADIUS; xOffset <= PRELOAD_RADIUS; xOffset += 1) {
        const x = (center.x + xOffset + tilesAtZoom) % tilesAtZoom;
        const y = clamp(center.y + yOffset, 0, tilesAtZoom - 1);
        urls.add(
          SATELLITE_TILE_TEMPLATE
            .replace('{z}', String(zoom))
            .replace('{y}', String(y))
            .replace('{x}', String(x)),
        );
      }
    }
  }

  return [...urls];
}

/**
 * Warms the browser's raster image cache without competing with the map for an
 * unbounded number of requests. MapLibre uses the same HTMLImageElement path
 * when refreshExpiredTiles is disabled, so these responses are reusable by the
 * real source rather than being held in a parallel application cache.
 */
export class SatelliteTilePreloader {
  private readonly seen = new Set<string>();
  private readonly queue: Array<{ priority: TilePriority; url: string }> = [];
  private readonly active = new Set<HTMLImageElement>();
  private cancelled = false;

  constructor(private readonly maxConcurrent = 4) {}

  enqueue(shots: CameraShot[], priority: TilePriority = 'low') {
    const additions = shots
      .flatMap(satelliteTileUrlsForShot)
      .filter((url) => {
        if (this.seen.has(url)) return false;
        this.seen.add(url);
        return true;
      })
      .map((url) => ({ priority, url }));

    if (priority === 'high') this.queue.unshift(...additions);
    else this.queue.push(...additions);
    this.pump();
  }

  cancel() {
    this.cancelled = true;
    this.queue.length = 0;
    for (const image of this.active) image.src = '';
    this.active.clear();
  }

  private pump() {
    if (this.cancelled) return;
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      const image = new Image();
      image.decoding = 'async';
      image.fetchPriority = next.priority;
      this.active.add(image);
      const settled = () => {
        image.onload = null;
        image.onerror = null;
        this.active.delete(image);
        this.pump();
      };
      image.onload = settled;
      image.onerror = settled;
      image.src = next.url;
    }
  }
}
