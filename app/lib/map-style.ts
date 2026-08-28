import type { StyleSpecification } from 'maplibre-gl';

export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Royal Duke satellite',
  projection: { type: 'globe' },
  sources: {
    esri: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'satellite',
      type: 'raster',
      source: 'esri',
      paint: {
        'raster-saturation': -0.22,
        'raster-contrast': 0.06,
        'raster-brightness-min': 0,
        'raster-brightness-max': 0.94,
        'raster-fade-duration': 0,
      },
    },
  ],
  sky: {
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4.5, 0.92, 7.4, 0],
  },
  light: {
    anchor: 'map',
    position: [1.35, 210, 28],
    color: '#f0e6d6',
    intensity: 0.35,
  },
};

export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: 'Royal Duke fallback',
  projection: { type: 'globe' },
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© CARTO, © OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'carto',
      type: 'raster',
      source: 'carto',
      paint: {
        'raster-saturation': -0.2,
        'raster-brightness-max': 0.62,
      },
    },
  ],
  sky: {
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4.5, 0.9, 7.4, 0],
  },
};

export const OPENFREEMAP_SOURCE = {
  type: 'vector' as const,
  url: 'https://tiles.openfreemap.org/planet',
};
