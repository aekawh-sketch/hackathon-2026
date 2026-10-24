// AR-сцена маршрута съёмки на WebXR (Chrome на Android с ARCore). Браузер сам показывает камеру и
// отслеживает, где телефон, — разметка стоит на полу, пока человек идёт. Мы рисуем ленту маршрута
// с бегущими шевронами и кольцо следующей точки. Связь мира WebXR с планом — `ArFrame` в map-core.
import type { XrPoint } from '@space-map/map-core';
import * as THREE from 'three';

export interface XrPose {
  position: XrPoint;
  /** Куда смотрит камера, единичный вектор. */
  forward: XrPoint;
}

/** Есть ли на устройстве AR с отслеживанием положения. */
export async function arSupported(): Promise<boolean> {
  try {
    return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

const COLOR = new THREE.Color('#7C3AED');
const ARRIVED = new THREE.Color('#12A150');
/** Ширина ленты маршрута и длина одного шеврона, м. */
const RIBBON_WIDTH = 0.32;
const TILE = 0.7;
/** Скорость бега шевронов, плиток в секунду. */
const FLOW = 0.9;
/** Как часто сообщать положение интерфейсу, мс: чаще не нужно, а React не любит перерисовки на каждый кадр. */
const POSE_EVERY = 100;

export class ArScene {
  /** Последнее известное положение камеры. */
  pose: XrPose | null = null;
  /** `local-floor` — пол на высоте 0; `local` — высоту пола оцениваем сами. */
  space: 'local-floor' | 'local' = 'local-floor';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly route = new THREE.Group();
  private readonly target = new THREE.Group();
  private readonly chevrons: THREE.CanvasTexture;
  private readonly ribbon: THREE.MeshBasicMaterial;
  private readonly joint: THREE.MeshBasicMaterial;
  private readonly targetMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly pulse: THREE.Mesh;
  private readonly label: THREE.Sprite;
  private session: XRSession | null = null;
  private lastPose = 0;
  private labelText = '1';

  constructor(
    private readonly overlay: HTMLElement,
    private readonly callbacks: { onPose: (pose: XrPose) => void; onEnd: () => void },
  ) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;

    this.chevrons = chevronTexture();
    this.ribbon = new THREE.MeshBasicMaterial({ map: this.chevrons, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.joint = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.9, depthWrite: false });
    this.scene.add(this.route, this.target);

    // Кольцо точки: полупрозрачный круг, белый обод, расходящаяся волна, столбик и номер над ним.
    const flat = (geometry: THREE.BufferGeometry, color: THREE.Color | string, opacity: number, y = 0.01) => {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      this.target.add(mesh);
      return mesh;
    };
    this.targetMaterials.push(flat(new THREE.CircleGeometry(0.45, 48), COLOR, 0.3).material as THREE.MeshBasicMaterial);
    flat(new THREE.RingGeometry(0.42, 0.5, 64), '#FFFFFF', 0.95, 0.012);
    this.pulse = flat(new THREE.RingGeometry(0.5, 0.56, 64), COLOR, 0.8, 0.014);
    this.targetMaterials.push(this.pulse.material as THREE.MeshBasicMaterial);
    const beamMaterial = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.55, depthWrite: false });
    this.targetMaterials.push(beamMaterial);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 12), beamMaterial);
    beam.position.y = 0.65;
    this.target.add(beam);
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('1', COLOR), depthTest: false }));
    this.label.scale.set(0.32, 0.32, 1);
    this.label.position.y = 1.45;
    this.target.add(this.label);
    this.target.visible = false;
  }

  /** Запуск AR-сеанса — только по нажатию кнопки. */
  async start(): Promise<void> {
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR недоступен');
    const overlay = { optionalFeatures: ['dom-overlay'], domOverlay: { root: this.overlay } };
    let session: XRSession;
    try {
      session = await xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], ...overlay });
      this.space = 'local-floor';
    } catch {
      session = await xr.requestSession('immersive-ar', overlay);
      this.space = 'local';
    }
    this.session = session;
    session.addEventListener('end', () => {
      this.renderer.setAnimationLoop(null);
      this.session = null;
      this.callbacks.onEnd();
    });
    this.renderer.xr.setReferenceSpaceType(this.space);
    await this.renderer.xr.setSession(session);
    this.renderer.setAnimationLoop((time, frame) => this.tick(time, frame));
  }

  /** Лента маршрута по точкам мира (уже на высоте пола) и кольцо следующей точки. */
  setRoute(points: XrPoint[], target: XrPoint | null, label: string): void {
    clear(this.route);
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len < 0.01) continue;
      this.route.add(new THREE.Mesh(ribbonSegment(a, b, walked / TILE, (walked + len) / TILE), this.ribbon));
      walked += len;
      // Круг на изломе — лента без зазоров на поворотах.
      if (i < points.length - 1) {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(RIBBON_WIDTH / 2, 24), this.joint);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(b[0], b[1] - 0.001, b[2]);
        this.route.add(disc);
      }
    }
    this.target.visible = !!target;
    if (target) this.target.position.set(target[0], target[1], target[2]);
    this.labelText = label;
    this.setArrived(false);
  }

  /** Человек дошёл — кольцо, столбик и номер зеленеют. */
  setArrived(arrived: boolean): void {
    const color = arrived ? ARRIVED : COLOR;
    for (const m of this.targetMaterials) m.color.copy(color);
    const sprite = this.label.material;
    sprite.map?.dispose();
    sprite.map = labelTexture(arrived ? '✓' : this.labelText, color);
    sprite.needsUpdate = true;
  }

  end(): void {
    void this.session?.end().catch(() => undefined);
  }

  dispose(): void {
    this.end();
    clear(this.route);
    this.renderer.dispose();
  }

  private tick(time: number, frame?: XRFrame): void {
    // Шевроны бегут к точке, волна расходится от кольца.
    this.chevrons.offset.x = -((time / 1000) * FLOW) % 1;
    const phase = (time % 1600) / 1600;
    this.pulse.scale.setScalar(1 + phase * 0.7);
    (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - phase);

    const space = this.renderer.xr.getReferenceSpace();
    const viewer = frame && space ? frame.getViewerPose(space) : undefined;
    if (viewer) {
      const { position: p, orientation: o } = viewer.transform;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
      this.pose = { position: [p.x, p.y, p.z], forward: [forward.x, forward.y, forward.z] };
      if (time - this.lastPose >= POSE_EVERY) {
        this.lastPose = time;
        this.callbacks.onPose(this.pose);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

/** Прямоугольник ленты от a до b на полу; u — вдоль, в плитках шеврона, чтобы рисунок шёл без стыков. */
function ribbonSegment(a: XrPoint, b: XrPoint, u0: number, u1: number): THREE.BufferGeometry {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  const nx = (-dz / len) * (RIBBON_WIDTH / 2);
  const nz = (dx / len) * (RIBBON_WIDTH / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([a[0] + nx, a[1], a[2] + nz, a[0] - nx, a[1], a[2] - nz, b[0] + nx, b[1], b[2] + nz, b[0] - nx, b[1], b[2] - nz], 3),
  );
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 1, u0, 0, u1, 1, u1, 0], 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(124, 58, 237, 0.88)';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(0, 0, 256, 10);
  ctx.fillRect(0, 118, 256, 10);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(96, 30);
  ctx.lineTo(150, 64);
  ctx.lineTo(96, 98);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function labelTexture(text: string, color: THREE.Color): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.fillStyle = `#${color.getHexString()}`;
  ctx.fill();
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 120px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function clear(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  }
}
