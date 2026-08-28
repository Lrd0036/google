'use client';

import { useEffect, useRef } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BeaconLayer } from '../lib/beacon-layer';
import { FALLBACK_STYLE, OPENFREEMAP_SOURCE, SATELLITE_STYLE } from '../lib/map-style';
import { docEase } from '../lib/motion';
import { NervousSystem } from '../lib/nervous-system';
import {
  INTRO_FLY_MS,
  INTRO_HOLD_MS,
  INTRO_SHOT,
  NODES,
  SHOTS,
  STAGES,
  siteCompromised,
} from '../lib/scenario';

type Props = {
  stage: number;
  pressure: number;
  intro: boolean;
  reduced: boolean;
  onIntroComplete: () => void;
};

export default function DocumentaryMap({
  stage,
  pressure,
  intro,
  reduced,
  onIntroComplete,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const labelsEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const beaconsRef = useRef<BeaconLayer | null>(null);
  const nervousRef = useRef<NervousSystem | null>(null);
  const introRef = useRef(intro);
  const onIntroCompleteRef = useRef(onIntroComplete);
  const introFinished = useRef(false);
  const arrivedFromIntro = useRef(false);
  const lastTick = useRef(0);
  const simRef = useRef({ stage, pressure, reduced });

  useEffect(() => {
    introRef.current = intro;
    onIntroCompleteRef.current = onIntroComplete;
    simRef.current = { stage, pressure, reduced };
    beaconsRef.current?.setState(simRef.current);
  }, [stage, pressure, reduced, intro, onIntroComplete]);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: mapEl.current,
      style: SATELLITE_STYLE,
      center: reduced ? SHOTS[0].center : INTRO_SHOT.center,
      zoom: reduced ? SHOTS[0].zoom : INTRO_SHOT.zoom,
      pitch: reduced ? SHOTS[0].pitch : INTRO_SHOT.pitch,
      bearing: reduced ? SHOTS[0].bearing : INTRO_SHOT.bearing,
      attributionControl: false,
      fadeDuration: 0,
      maxPitch: 80,
      minZoom: 1.15,
      maxZoom: 17.2,
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;
    const nervous = new NervousSystem();
    nervousRef.current = nervous;
    const beacons = new BeaconLayer();
    beacons.setState({ stage, pressure, reduced });
    beaconsRef.current = beacons;

    const resizeFx = () => {
      const canvas = canvasEl.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = map.getContainer().clientWidth;
      const h = map.getContainer().clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    const paintLabels = () => {
      const host = labelsEl.current;
      if (!host) return;
      const zoom = map.getZoom();
      const sim = simRef.current;
      const show = !introRef.current;
      for (const node of NODES) {
        const el = host.querySelector<HTMLElement>(`[data-site="${node.id}"]`);
        if (!el) continue;
        const labeled = node.labeled !== false;
        const minZoom = node.kind === 'load' ? 11.2 : 8.2;
        if (!labeled || !show || zoom < minZoom || sim.stage < node.reveal) {
          el.dataset.hide = 'true';
          continue;
        }
        const p = map.project(node.lngLat);
        el.dataset.hide = 'false';
        el.dataset.hot = siteCompromised(node, sim.stage) ? 'true' : 'false';
        el.style.transform = `translate(${p.x + 18}px, ${p.y - 14}px)`;
      }
    };

    const onFrame = () => {
      const canvas = canvasEl.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      const now = performance.now();
      const dt = lastTick.current === 0 ? 0 : Math.min(0.05, (now - lastTick.current) / 1000);
      lastTick.current = now;
      const sim = simRef.current;
      beacons.setState(sim);
      nervous.tick(dt, { ...sim, now });
      nervous.draw(ctx, map, { ...sim, now });
      paintLabels();
    };

    const fallbackTimer = window.setTimeout(() => {
      if (!map.isStyleLoaded()) {
        map.setStyle(FALLBACK_STYLE);
        map.setProjection({ type: 'globe' });
      }
    }, 8000);

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      try {
        if (!map.getLayer('beacons')) map.addLayer(beacons);
      } catch {
        /* three.js layer is enhancement */
      }
      try {
        if (!map.getSource('openfreemap')) map.addSource('openfreemap', OPENFREEMAP_SOURCE);
        if (!map.getLayer('buildings-3d')) {
          map.addLayer({
            id: 'buildings-3d',
            type: 'fill-extrusion',
            source: 'openfreemap',
            'source-layer': 'building',
            minzoom: 12,
            paint: {
              'fill-extrusion-color': '#12100e',
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.42,
            },
          });
        }
      } catch {
        /* buildings are an enhancement, not required */
      }
    });

    map.on('load', () => {
      window.clearTimeout(fallbackTimer);
      resizeFx();
      if (simRef.current.reduced) {
        introFinished.current = true;
        arrivedFromIntro.current = true;
        onIntroCompleteRef.current();
        return;
      }
      window.setTimeout(() => {
        if (!introRef.current || introFinished.current) return;
        map.flyTo({
          center: SHOTS[0].center,
          zoom: SHOTS[0].zoom,
          pitch: SHOTS[0].pitch,
          bearing: SHOTS[0].bearing,
          duration: INTRO_FLY_MS,
          easing: docEase,
          essential: true,
        });
        map.once('moveend', () => {
          if (introFinished.current || !introRef.current) return;
          introFinished.current = true;
          arrivedFromIntro.current = true;
          onIntroCompleteRef.current();
        });
      }, INTRO_HOLD_MS);
    });

    map.on('resize', resizeFx);
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      map.resize();
      resizeFx();
    });
    if (mapEl.current) ro.observe(mapEl.current);
    let raf = 0;
    const loop = () => {
      onFrame();
      map.triggerRepaint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      window.clearTimeout(fallbackTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      beaconsRef.current = null;
      nervousRef.current = null;
    };
    // init once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || intro) return;
    map.stop();
    introFinished.current = true;
    if (arrivedFromIntro.current && stage === 0) {
      arrivedFromIntro.current = false;
      return;
    }
    const shot = SHOTS[stage];
    if (reduced) {
      map.jumpTo({ center: shot.center, zoom: shot.zoom, pitch: shot.pitch, bearing: shot.bearing });
      return;
    }
    map.flyTo({
      center: shot.center,
      zoom: shot.zoom,
      pitch: shot.pitch,
      bearing: shot.bearing,
      duration: shot.duration,
      easing: docEase,
      essential: true,
    });
  }, [stage, intro, reduced]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('satellite')) return;
    try {
      map.setPaintProperty('satellite', 'raster-brightness-max', STAGES[stage].visual.blackout ? 0.48 : 0.94);
    } catch {
      /* style may still be loading */
    }
  }, [stage]);

  return (
    <div className="world" ref={rootRef}>
      <div ref={mapEl} className="world-map" />
      <canvas ref={canvasEl} className="world-fx" />
      <div ref={labelsEl} className="world-labels">
        {NODES.map((node) => (
          <div key={node.id} className="site-label" data-site={node.id} data-kind={node.kind} data-hide="true">
            <span>{node.kicker}</span>
            <strong>{node.label}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
