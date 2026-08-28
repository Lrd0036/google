import { Map as MapLibreMap, MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput } from 'maplibre-gl';
import * as THREE from 'three';
import { NODES, siteCompromised, type SiteNode } from './scenario';

const EARTH_RADIUS = 6371008.8;
const PAPER = 0xf3eee4;
const BLOOD = 0xc5122a;

type BeaconGroup = {
  node: SiteNode;
  root: THREE.Group;
  body: THREE.Mesh;
  glow: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
};

export type BeaconState = {
  stage: number;
  contained: boolean;
  blockStage: number;
  pressure: number;
  reduced: boolean;
};

function getMercatorModelMatrix(location: [number, number], altitude: number) {
  const merc = MercatorCoordinate.fromLngLat(location, altitude);
  const scale = merc.meterInMercatorCoordinateUnits();
  return new THREE.Matrix4()
    .makeTranslation(merc.x, merc.y, merc.z)
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(-scale, scale, scale));
}

function getGlobeModelMatrix(location: [number, number], altitude: number) {
  const [lng, lat] = location;
  const scale = 1 / EARTH_RADIUS;
  return new THREE.Matrix4()
    .makeRotationY((lng / 180) * Math.PI)
    .multiply(new THREE.Matrix4().makeRotationX((-lat / 180) * Math.PI))
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, 1 + altitude / EARTH_RADIUS))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
}

function monumentGeometry(kind: SiteNode['monument']) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0.92 });
  const glowMat = new THREE.MeshBasicMaterial({
    color: PAPER,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

    if (kind === 'campus') {
    const a = new THREE.Mesh(new THREE.BoxGeometry(42, 360, 34), mat);
    a.position.set(-26, 180, 0);
    const b = new THREE.Mesh(new THREE.BoxGeometry(34, 480, 34), mat);
    b.position.set(16, 240, 12);
    const c = new THREE.Mesh(new THREE.BoxGeometry(24, 260, 24), mat);
    c.position.set(42, 130, -18);
    group.add(a, b, c);
  } else if (kind === 'water') {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 110, 24), mat);
    tank.position.y = 55;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 240, 12), mat);
    neck.position.y = 220;
    group.add(tank, neck);
  } else if (kind === 'hall') {
    const hall = new THREE.Mesh(new THREE.BoxGeometry(16, 210, 12), mat);
    hall.position.y = 105;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 16), mat);
    roof.position.y = 214;
    group.add(hall, roof);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(48, 180, 36), mat);
    body.position.y = 90;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(54, 12, 42), mat);
    roof.position.y = 186;
    group.add(body, roof);
  }

  const hall = kind === 'hall';
  const glow = new THREE.Mesh(new THREE.ConeGeometry(hall ? 36 : 72, hall ? 340 : 640, 20, 1, true), glowMat);
  glow.position.y = hall ? 170 : 320;
  group.add(glow);
  const body = group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh) ?? glow;
  return { group, body, glow, mat, glowMat };
}

export class BeaconLayer implements CustomLayerInterface {
  id = 'beacons';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  map: MapLibreMap | null = null;
  camera = new THREE.Camera();
  scene = new THREE.Scene();
  renderer: THREE.WebGLRenderer | null = null;
  beacons: BeaconGroup[] = [];
  state: BeaconState = { stage: 0, contained: false, blockStage: Number.POSITIVE_INFINITY, pressure: 62, reduced: false };
  time = 0;

  setState(next: BeaconState) {
    this.state = next;
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.camera.matrixAutoUpdate = false;
    for (const node of NODES) {
      const built = monumentGeometry(node.monument);
      built.group.matrixAutoUpdate = false;
      this.scene.add(built.group);
      this.beacons.push({
        node,
        root: built.group,
        body: built.body,
        glow: built.glow,
        material: built.mat,
        glowMaterial: built.glowMat,
      });
    }
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
  }

  onRemove() {
    for (const beacon of this.beacons) {
      beacon.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
      });
      beacon.material.dispose();
      beacon.glowMaterial.dispose();
    }
    this.beacons = [];
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  render(_gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.renderer || !this.map) return;
    const gl = this.renderer.getContext();
    if ('isContextLost' in gl && gl.isContextLost()) return;
    try {
      this.time = performance.now();
      const zoom = this.map.getZoom();
      const zoomScale = 2 ** Math.max(0, 10.2 - Math.min(zoom, 10.2));
      const projection = args.defaultProjectionData as { mainMatrix: ArrayLike<number>; projectionTransition?: number };
      const isGlobe = (projection.projectionTransition ?? 0) > 0.5;
      const { stage, contained, blockStage, pressure, reduced } = this.state;

      for (const beacon of this.beacons) {
        const visible = stage >= beacon.node.reveal && zoom >= 5.8;
        beacon.root.visible = visible;
        if (!visible) continue;
        const hot = siteCompromised(beacon.node, stage, contained, blockStage);
        const color = hot ? BLOOD : PAPER;
        beacon.material.color.setHex(color);
        beacon.glowMaterial.color.setHex(color);
        const pulse = reduced ? 1 : 1 + Math.sin(this.time * 0.003 + beacon.node.lngLat[0]) * (hot ? 0.08 : 0.03);
        let height = pulse;
        if (beacon.node.id === 'water') height *= Math.max(0.28, pressure / 62);
        if (beacon.node.kind === 'load') height *= 1.35;
        if (stage >= 5 && beacon.node.kind === 'load' && !contained) {
          beacon.material.opacity = 0.18;
          beacon.glowMaterial.opacity = 0.04;
        } else {
          beacon.material.opacity = hot ? 0.96 : 0.78;
          beacon.glowMaterial.opacity = hot ? 0.22 : 0.1;
        }
        const matrix = isGlobe
          ? getGlobeModelMatrix(beacon.node.lngLat, 0)
          : getMercatorModelMatrix(beacon.node.lngLat, 0);
        matrix.scale(new THREE.Vector3(zoomScale, zoomScale * height, zoomScale));
        beacon.root.matrix.copy(matrix);
      }

      const m = new THREE.Matrix4().fromArray(Array.from(projection.mainMatrix) as number[]);
      this.camera.projectionMatrix.copy(m);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
    } catch {
      /* MapLibre and three.js share a GL context; skip a torn frame */
    }
  }
}
