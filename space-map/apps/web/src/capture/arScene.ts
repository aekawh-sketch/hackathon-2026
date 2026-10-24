// AR-сцена маршрута съёмки на WebXR (Chrome на Android с ARCore). Браузер сам показывает камеру и
// отслеживает, где телефон, — разметка стоит на полу, пока человек идёт. Мы рисуем ленту маршрута
// с бегущими шевронами и кольцо следующей точки. Связь мира WebXR с планом — `ArFrame` в map-core.
// В точке — съёмка фотосферы: кадры камеры (`camera-access`) раскладываются на сферу по повороту из ARCore (`PanoBuilder`).
import { SphereCoverage, type CameraFrustum, type XrPoint } from '@space-map/map-core';
import * as THREE from 'three';
import { PanoBuilder } from './panoBuilder.ts';

export interface XrPose {
  position: XrPoint;
  /** Куда смотрит камера, единичный вектор. */
  forward: XrPoint;
}

/** AR не запустился: `code` — имя ошибки браузера (NotSupportedError, NotAllowedError…) или наше (`no_xr`, `no_overlay`). */
export class ArStartError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Есть ли на устройстве AR с отслеживанием положения. Ответ «да» не гарантирует запуск — см. `ArStartError`. */
export async function arSupported(): Promise<boolean> {
  try {
    return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

/** Как идёт съёмка фотосферы — для подсказок на экране. */
export interface SphereProgress {
  /** Доля снятой сферы, 0…1. */
  fraction: number;
  frames: number;
  /** Человек ушёл с места съёмки дальше вытянутой руки — кадры не снимаются. */
  moved: boolean;
  /** Телефон отходит от места: ещё снимаем, но просим держать ближе. */
  far: boolean;
  /** Опора слабая (белая стена, потолок): положение условное, но поворот от гироскопа есть — снимаем по нему. */
  weak: boolean;
  /** Положения нет совсем дольше 0,7 с — кадров камеры тоже нет, снимать нечем. */
  lost: boolean;
  steady: boolean;
  /** Куда повернуть телефон к неснятому; null — держите как есть. */
  hint: 'left' | 'right' | 'up' | 'down' | null;
  /** Кадров камеры нет: браузер не дал `camera-access`. */
  noCamera: boolean;
  /**
   * Место съёмки, если телефон от него ушёл: сколько метров и под каким углом от взгляда
   * (градусы, + — правее, по часовой). null — на месте или положение условное.
   */
  home: { distance: number; angle: number } | null;
}

// В @types/webxr нет модуля доступа к камере (WebXR Raw Camera Access) — описываем то, чем пользуемся.
interface XrViewWithCamera {
  camera?: unknown;
}
interface XrCameraBinding {
  getCameraImage(camera: unknown): WebGLTexture | null;
}

/** Снимать, если в кадре столько ещё не снятого, телефон неподвижен и человек на месте. */
const SHOT_GAIN = 0.2;
const STEADY_DEG = 1.5;
const STEADY_MS = 250;
const SHOT_EVERY = 350;
/**
 * Телефон в руке ходит по кругу радиусом до полуметра, пока человек поворачивается, — это нормально.
 * Дальше — просим держать ближе; ещё дальше — человек ушёл с места, кадры снимать нельзя.
 */
const FAR_MOVE = 0.6;
const MAX_MOVE = 1.2;
/** За один кадр (~16 мс) так далеко не уйти — это ARCore заново нашёл опору и сдвинул мир. */
const JUMP = 0.25;
/** Столько без положения — считаем, что опора потеряна. */
const LOST_MS = 700;
/** Дальше — показываем на полу и внизу экрана, куда вернуться. */
const HOME_HINT = 0.45;
const HOME = new THREE.Color('#12A150');

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
  /** Браузер дал кадры камеры — можно снимать фотосферу. */
  cameraAccess = false;
  private sphere: {
    builder: PanoBuilder;
    coverage: SphereCoverage;
    center: THREE.Vector3;
    history: { t: number; f: THREE.Vector3 }[];
    last: THREE.Vector3 | null;
    lastPoseAt: number;
    lastShot: number;
    lastReport: number;
    lastDots: number;
    dots: THREE.Points;
    camera: THREE.ExternalTexture;
    /** Место съёмки на полу: зелёное кольцо и бегущая к нему стрелка от ног. */
    home: THREE.Group;
    homeArrow: THREE.Mesh;
    homeChevrons: THREE.Texture;
    floorY: number;
  } | null = null;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly callbacks: {
      onPose: (pose: XrPose) => void;
      onEnd: () => void;
      onSphere?: (progress: SphereProgress) => void;
      onShot?: () => void;
    },
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
    if (!xr) throw new ArStartError('no_xr', 'WebXR недоступен');
    let session: XRSession;
    try {
      // Один запрос, всё необязательное: повторный запрос после отказа браузер может не пустить —
      // нажатие кнопки уже «израсходовано», а обязательная возможность, которой нет, роняет весь запуск.
      session = await xr.requestSession('immersive-ar', {
        optionalFeatures: ['local-floor', 'dom-overlay', 'camera-access'],
        domOverlay: { root: this.overlay },
      });
    } catch (err) {
      throw new ArStartError(err instanceof DOMException ? err.name : 'Error', err instanceof Error ? err.message : String(err));
    }
    // Без слоя поверх камеры не видно кнопок — в таком AR не нажать «Навёл».
    if (!session.domOverlayState) {
      await session.end().catch(() => undefined);
      throw new ArStartError('no_overlay', 'Браузер не показывает кнопки поверх AR');
    }
    try {
      await session.requestReferenceSpace('local-floor');
      this.space = 'local-floor';
    } catch {
      this.space = 'local';
    }
    // Старый Chrome не сообщает включённые возможности — тогда узнаем по первому кадру съёмки.
    this.cameraAccess = session.enabledFeatures?.includes('camera-access') ?? true;
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

  // ── Фотосфера ──

  /**
   * Начать съёмку фотосферы с места, где сейчас камера. Лента и кольцо прячутся, вокруг — точки «сюда навести»,
   * на полу — зелёное кольцо места съёмки. `floorY` — высота пола в мире WebXR.
   */
  startSphere(floorY: number): void {
    if (!this.pose) throw new Error('Нет положения камеры');
    this.cancelSphere();
    const home = new THREE.Group();
    const flat = (geometry: THREE.BufferGeometry, color: THREE.Color | string, opacity: number) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      home.add(mesh);
      return mesh;
    };
    flat(new THREE.CircleGeometry(0.3, 40), HOME, 0.3);
    flat(new THREE.RingGeometry(0.28, 0.34, 48), '#FFFFFF', 0.95);
    const homeChevrons = this.chevrons.clone();
    homeChevrons.needsUpdate = true;
    // Плоскость 1 × 1 сразу на полу: вдоль x — длина (по ней бегут шевроны), вдоль z — ширина.
    const arrowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const homeArrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ map: homeChevrons, color: HOME, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    homeArrow.visible = false;
    this.scene.add(home, homeArrow);
    const dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ map: dotTexture(), color: COLOR, size: 0.11, transparent: true, depthTest: false, alphaTest: 0.2 }));
    dots.renderOrder = 10;
    this.scene.add(dots);
    this.sphere = {
      builder: new PanoBuilder(this.renderer),
      coverage: new SphereCoverage(),
      center: new THREE.Vector3(...this.pose.position),
      history: [],
      last: null,
      lastPoseAt: 0,
      lastShot: 0,
      lastReport: 0,
      lastDots: 0,
      dots,
      camera: new THREE.ExternalTexture(null),
      home,
      homeArrow,
      homeChevrons,
      floorY,
    };
    home.position.set(this.pose.position[0], floorY + 0.01, this.pose.position[2]);
    this.route.visible = false;
    this.target.visible = false;
    this.updateDots();
  }

  /** Начать сферу заново на том же месте. */
  restartSphere(): void {
    if (!this.sphere) return;
    this.sphere.builder.clear();
    this.sphere.coverage.reset();
    this.updateDots();
  }

  /** Закончить съёмку: панорама JPEG 2:1 и сколько кадров в ней. */
  async finishSphere(): Promise<{ blob: Blob; frames: number; fraction: number }> {
    const s = this.sphere;
    if (!s) throw new Error('Съёмка не начата');
    const result = { blob: await s.builder.toBlob(), frames: s.builder.frames, fraction: s.coverage.fraction };
    this.cancelSphere();
    return result;
  }

  cancelSphere(): void {
    const s = this.sphere;
    if (!s) return;
    this.sphere = null;
    this.scene.remove(s.dots, s.home, s.homeArrow);
    s.dots.geometry.dispose();
    s.homeArrow.geometry.dispose();
    s.homeChevrons.dispose();
    s.builder.dispose();
    this.route.visible = true;
    this.target.visible = this.route.children.length > 0;
  }

  end(): void {
    void this.session?.end().catch(() => undefined);
  }

  dispose(): void {
    this.cancelSphere();
    this.end();
    clear(this.route);
    this.renderer.dispose();
  }

  /** Точки на сфере радиусом 1,6 м вокруг телефона — там, где ещё не снято. Важны направления, а не место. */
  private updateDots(): void {
    const s = this.sphere;
    if (!s) return;
    const pts: number[] = [];
    for (const lat of [-60, -35, -10, 15, 40, 65, 85]) {
      const n = Math.max(1, Math.round(14 * Math.cos((lat * Math.PI) / 180)));
      for (let i = 0; i < n; i++) {
        const lon = (i / n) * Math.PI * 2;
        const r = (lat * Math.PI) / 180;
        const dir: XrPoint = [Math.sin(lon) * Math.cos(r), Math.sin(r), -Math.cos(lon) * Math.cos(r)];
        if (s.coverage.coveredAt(dir)) continue;
        pts.push(dir[0] * 1.6, dir[1] * 1.6, dir[2] * 1.6);
      }
    }
    s.dots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    s.dots.geometry.computeBoundingSphere();
  }

  private sphereTick(time: number, view: XRView, emulated: boolean): void {
    const s = this.sphere!;
    const o = view.transform.orientation;
    const q = new THREE.Quaternion(o.x, o.y, o.z, o.w);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const p = view.transform.position;
    const here = new THREE.Vector3(p.x, p.y, p.z);
    // Точки всегда вокруг телефона: человек поворачивается, телефон в руке ходит по кругу — точки не должны «уплывать».
    s.dots.position.copy(here);

    // ARCore заново нашёл опору и сдвинул мир — место съёмки переезжает вместе с ним, ждём, пока телефон замрёт.
    if (s.last && s.last.distanceTo(here) > JUMP) {
      s.center.add(here.clone().sub(s.last));
      s.history.length = 0;
    }
    s.home.position.set(s.center.x, s.floorY + 0.01, s.center.z);
    s.last = here;
    const dx = here.x - s.center.x;
    const dz = here.z - s.center.z;
    // При слабой опоре положение условное — уход с места по нему не считаем, снимаем по повороту.
    const weak = emulated;
    const away = weak ? 0 : Math.hypot(dx, dz);
    const moved = away > MAX_MOVE;
    const far = away > FAR_MOVE;
    s.lastPoseAt = time;

    // Ушли с места — стрелка на полу от ног к кольцу и направление для подсказки внизу экрана.
    let home: SphereProgress['home'] = null;
    s.homeArrow.visible = away > HOME_HINT;
    if (away > HOME_HINT) {
      const len = away;
      s.homeArrow.position.set((here.x + s.center.x) / 2, s.floorY + 0.015, (here.z + s.center.z) / 2);
      s.homeArrow.rotation.y = Math.atan2(dz, -dx);
      s.homeArrow.scale.set(len, 1, RIBBON_WIDTH);
      s.homeChevrons.repeat.x = len / TILE;
      s.homeChevrons.offset.x = -((time / 1000) * FLOW) % 1;
      const facing = Math.atan2(forward.x, -forward.z);
      const toHome = Math.atan2(-dx, dz);
      let angle = ((toHome - facing) * 180) / Math.PI;
      angle = ((angle + 540) % 360) - 180;
      home = { distance: away, angle };
    }

    // Телефон неподвижен, если за последние 250 мс взгляд почти не сдвинулся.
    s.history.push({ t: time, f: forward.clone() });
    while (s.history.length && time - s.history[0]!.t > STEADY_MS) s.history.shift();
    const steady = s.history.length > 3 && s.history.every((h) => h.f.angleTo(forward) < (STEADY_DEG * Math.PI) / 180);

    const P = view.projectionMatrix;
    const frustum: CameraFrustum = { q: [q.x, q.y, q.z, q.w], tanX: 1 / P[0]!, tanY: 1 / P[5]! };
    const cameraCam = (view as XRView & XrViewWithCamera).camera;
    const noCamera = !cameraCam;
    if (cameraCam && steady && !moved && time - s.lastShot > SHOT_EVERY && s.coverage.gain(frustum) >= SHOT_GAIN) {
      const binding = this.renderer.xr.getBinding() as unknown as XrCameraBinding | null;
      const image = binding?.getCameraImage(cameraCam) ?? null;
      if (image) {
        s.camera.sourceTexture = image;
        s.builder.stamp(s.camera, q, new THREE.Matrix4().fromArray(P));
        s.coverage.mark(frustum);
        s.lastShot = time;
        this.callbacks.onShot?.();
        this.updateDots();
      }
    }

    if (time - s.lastReport >= 120) {
      s.lastReport = time;
      // Куда повернуть: ближайшее неснятое в системе камеры.
      let hint: SphereProgress['hint'] = null;
      const missing = s.coverage.nearestMissing([forward.x, forward.y, forward.z]);
      if (missing) {
        const c = new THREE.Vector3(...missing).applyQuaternion(q.clone().invert());
        const off = Math.atan2(Math.hypot(c.x, c.y), -c.z);
        if (off > (20 * Math.PI) / 180) hint = Math.abs(c.x) >= Math.abs(c.y) ? (c.x > 0 ? 'right' : 'left') : c.y > 0 ? 'up' : 'down';
      }
      this.callbacks.onSphere?.({ fraction: s.coverage.fraction, frames: s.builder.frames, moved, far, weak, lost: false, steady, hint, noCamera, home });
    }
  }

  private tick(time: number, frame?: XRFrame): void {
    // Шевроны бегут к точке, волна расходится от кольца.
    this.chevrons.offset.x = -((time / 1000) * FLOW) % 1;
    const phase = (time % 1600) / 1600;
    this.pulse.scale.setScalar(1 + phase * 0.7);
    (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - phase);

    const space = this.renderer.xr.getReferenceSpace();
    const viewer = frame && space ? frame.getViewerPose(space) : undefined;
    if (viewer && this.sphere && viewer.views[0]) this.sphereTick(time, viewer.views[0], viewer.emulatedPosition);
    else if (this.sphere && time - this.sphere.lastPoseAt > LOST_MS && time - this.sphere.lastReport >= 120) {
      // Положения нет совсем — ARCore не за что зацепиться; кадров камеры в такой момент тоже нет.
      const s = this.sphere;
      s.lastReport = time;
      s.history.length = 0;
      this.callbacks.onSphere?.({ fraction: s.coverage.fraction, frames: s.builder.frames, moved: false, far: false, weak: true, lost: true, steady: false, hint: null, noCamera: false, home: null });
    }
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

function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

function clear(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  }
}
