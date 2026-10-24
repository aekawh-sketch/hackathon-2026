// 3D-вид этажа (ТЗ 5.18): модель строится из плана, без внешних файлов, и выгружается в glTF (.glb).
// Оформление «макет на столе»: светлые стены с тёмным срезом, мягкие тени, подписи помещений и значки мест.
import { buildModel3D, doorLeaves, doorStyleOf, type MapDocument, type Vec2 } from '@space-map/map-core';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { drawFloorPlan, type FloorPlan } from '../plan/floorTexture.ts';
import { ENTRANCE, PANORAMA, ROUTE, UNIT_FLOOR_3D } from '../plan/style.ts';
import { polygonCentroid, type Insets } from '../plan/viewport.ts';
import { categoryIconPath, Icon } from '../ui/icons.tsx';

export interface Model3DViewProps {
  doc: MapDocument;
  level: string;
  route?: Vec2[] | null;
  selectedPlace?: string | null;
  onPlaceClick?: (id: string) => void;
  insets?: Insets;
  /** Шарики на местах съёмки панорам — для организатора; посетитель их не видит. */
  showPanoramas?: boolean;
}

const WALL_HEIGHT = 2.7;
const WALL_THICKNESS = 0.16;
const DOOR_HEIGHT = 2.1;
const CUT_SCALE = 0.36;
const FONT = '600 30px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// План (x, y) → three (x, −z): y плана уходит «вглубь», ось three Y — вверх.
const v3 = (p: Vec2, h = 0) => new THREE.Vector3(p[0], h, -p[1]);

/** Здание без подписей и значков — оно же уходит в .glb. */
export function buildScene(doc: MapDocument, level: string): THREE.Group {
  const model = buildModel3D(doc, level, { wallHeight: WALL_HEIGHT, obstacleHeight: 1.1 });
  const root = new THREE.Group();
  root.name = doc.venue.name;

  // На полу — 2D-план этажа: одна текстура на все помещения, у каждого пола она лежит по координатам плана.
  const plan = drawFloorPlan(doc, level);
  let planTop: THREE.MeshStandardMaterial | null = null;
  if (plan) {
    const map = new THREE.CanvasTexture(plan.canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8; // пол видно под острым углом — без анизотропии подписи расплываются
    planTop = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  }
  const floors = new THREE.Group();
  floors.name = 'floors';
  for (const floor of model.floors) {
    const shape = new THREE.Shape(floor.polygon.map((p) => new THREE.Vector2(p[0], p[1])));
    // Вырез — дыра и в полу: колонна или шахта не покрыта полом помещения.
    for (const hole of floor.holes) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p[0], p[1]))));
    const color = UNIT_FLOOR_3D[floor.kind as keyof typeof UNIT_FLOOR_3D] ?? '#EDF1F7';
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    const side = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
    if (plan) planUV(geometry, plan);
    // Группы ExtrudeGeometry: 0 — верх и низ (план), 1 — торцы плиты (цвет пола).
    const mesh = new THREE.Mesh(geometry, planTop ? [planTop, side] : side);
    mesh.rotation.x = -Math.PI / 2; // Shape лежит в XY → кладём на пол, выдавливание идёт вверх
    mesh.receiveShadow = true;
    mesh.name = `floor:${floor.unit}`;
    floors.add(mesh);
  }
  root.add(floors);

  // Стены: светлые грани и тёмный «срез» сверху, как на архитектурном макете.
  const walls = new THREE.Group();
  walls.name = 'walls';
  const side = new THREE.MeshStandardMaterial({ color: '#F8FAFD', roughness: 0.85 });
  const cap = new THREE.MeshStandardMaterial({ color: '#253047', roughness: 0.6 });
  const wallMaterials = [side, side, cap, side, side, side];
  for (const [i, w] of model.walls.entries()) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_THICKNESS, w.height, WALL_THICKNESS), wallMaterials);
    const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    mesh.position.copy(v3(mid, w.height / 2));
    mesh.rotation.y = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `wall:${i}`;
    walls.add(mesh);
  }
  root.add(walls);

  // Перемычки над дверями — проём читается как дверь, а не как дыра в стене.
  const lintels = new THREE.Group();
  lintels.name = 'lintels';
  for (const o of doc.openings) {
    if (o.level !== level || o.kind === 'entrance') continue;
    const [a, b] = o.segment;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const h = WALL_HEIGHT - DOOR_HEIGHT;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, WALL_THICKNESS), wallMaterials);
    mesh.position.copy(v3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], DOOR_HEIGHT + h / 2));
    mesh.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]);
    mesh.castShadow = true;
    mesh.name = `lintel:${o.id}`;
    lintels.add(mesh);
  }
  root.add(lintels);

  // Полотна дверей: повёрнуты на угол открывания вокруг петли (ТЗ 5.18, настройки створок — doorStyleOf).
  const doors = new THREE.Group();
  doors.name = 'doors';
  const leafMaterial = new THREE.MeshStandardMaterial({ color: '#D9C2A3', roughness: 0.65 });
  const handleMaterial = new THREE.MeshStandardMaterial({ color: '#5B6475', roughness: 0.3, metalness: 0.6 });
  for (const o of doc.openings) {
    if (o.level !== level) continue;
    const style = doorStyleOf(doc, o);
    if (!style) continue;
    for (const [i, leaf] of doorLeaves(o, style).entries()) {
      const width = Math.max(leaf.length - 0.02, 0.05);
      // Шарнир в петле: группа повёрнута как створка на плане, полотно сдвинуто вдоль неё.
      const hinge = new THREE.Group();
      hinge.position.copy(v3(leaf.hinge, 0.06));
      hinge.rotation.y = leaf.angle;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(width, DOOR_HEIGHT - 0.08, 0.045), leafMaterial);
      panel.position.set(width / 2 + 0.01, (DOOR_HEIGHT - 0.08) / 2, 0);
      panel.castShadow = true;
      panel.receiveShadow = true;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.1), handleMaterial);
      handle.position.set(width - 0.1, 1.0, 0);
      hinge.add(panel, handle);
      hinge.name = `door:${o.id}:${i}`;
      doors.add(hinge);
    }
  }
  root.add(doors);

  // Вход — зелёная полоса на полу.
  for (const o of doc.openings) {
    if (o.level !== level || o.kind !== 'entrance') continue;
    const [a, b] = o.segment;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.5), new THREE.MeshStandardMaterial({ color: ENTRANCE, emissive: ENTRANCE, emissiveIntensity: 0.25 }));
    mesh.position.copy(v3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0.075));
    mesh.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]);
    mesh.name = `entrance:${o.id}`;
    root.add(mesh);
  }

  const blockMaterial = new THREE.MeshStandardMaterial({ color: '#C7D0DD', roughness: 0.7 });
  for (const b of model.blocks) {
    const shape = new THREE.Shape(b.polygon.map((p) => new THREE.Vector2(p[0], p[1])));
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }), blockMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `block:${b.id}`;
    root.add(mesh);
  }
  return root;
}

/** Координаты текстуры по плану: точка (x, y) пола берёт свой пиксель плана — помещения стыкуются без швов. */
function planUV(geometry: THREE.BufferGeometry, plan: FloorPlan) {
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - plan.minX) / plan.width;
    uv[i * 2 + 1] = (pos.getY(i) - plan.minY) / plan.height;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ── Подписи и значки: спрайты из canvas, всегда повёрнуты к камере ──

function canvasSprite(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number, worldHeight: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set((worldHeight * w) / h, worldHeight, 1);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function labelSprite(text: string): THREE.Sprite {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = FONT;
  const w = Math.ceil(measure.measureText(text).width) + 44;
  const h = 56;
  const sprite = canvasSprite(
    (ctx) => {
      ctx.font = FONT;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, 2, 2, w - 4, h - 4, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(31,42,61,0.12)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#1A2433';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 22, h / 2 + 1);
    },
    w,
    h,
    0.62,
  );
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 2;
  return sprite;
}

function pinSprite(color: string, icon: string): THREE.Sprite {
  const w = 120;
  const h = 150;
  const sprite = canvasSprite(
    (ctx) => {
      const cx = w / 2;
      const cy = 56;
      const r = 46;
      // Капля: круг и острие вниз
      ctx.shadowColor = 'rgba(14,23,38,0.35)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(cx, h - 8);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      // Иконка тем же набором путей, что на плане
      ctx.save();
      const s = 2.6;
      ctx.translate(cx - 12 * s, cy - 12 * s);
      ctx.scale(s, s);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(categoryIconPath(icon)));
      ctx.restore();
    },
    w,
    h,
    1.25,
  );
  sprite.center.set(0.5, 0.03);
  sprite.renderOrder = 3;
  return sprite;
}

interface Stage3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  building: THREE.Group;
  walls: THREE.Object3D[];
  lintels: THREE.Object3D | undefined;
  labels: THREE.Group;
  pins: Map<string, THREE.Sprite>;
  routeGroup: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  fly: { pos: THREE.Vector3; target: THREE.Vector3 } | null;
  walker: { curve: THREE.Curve<THREE.Vector3>; mesh: THREE.Mesh; t: number } | null;
}

export function Model3DView({ doc, level, route, selectedPlace, onPlaceClick, insets, showPanoramas = false }: Model3DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage3D | null>(null);
  const clickRef = useRef(onPlaceClick);
  clickRef.current = onPlaceClick;
  const [cut, setCut] = useState(false);
  const [spin, setSpin] = useState(false);

  // Сцена: пересобирается только при смене плана или этажа.
  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#E9EDF3');

    const building = buildScene(doc, level);
    scene.add(building);
    const box = new THREE.Box3().setFromObject(building);
    const center = box.getCenter(new THREE.Vector3());
    const sizeV = box.getSize(new THREE.Vector3());
    const radius = Math.max(sizeV.length() / 2, 4);
    scene.fog = new THREE.Fog('#E9EDF3', radius * 3, radius * 7);

    scene.add(new THREE.HemisphereLight('#FFFFFF', '#B8C2D1', 1.6));
    const sun = new THREE.DirectionalLight('#FFF7EC', 2.2);
    sun.position.set(center.x - radius * 0.6, radius * 1.6, center.z + radius * 0.9);
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    const sc = sun.shadow.camera;
    sc.left = -radius * 1.3;
    sc.right = radius * 1.3;
    sc.top = radius * 1.3;
    sc.bottom = -radius * 1.3;
    sc.near = 1;
    sc.far = radius * 5;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#DCE6FF', 0.6);
    fill.position.set(center.x + radius, radius, center.z - radius);
    scene.add(fill);

    // «Стол» под макетом
    const ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 6, 64), new THREE.MeshStandardMaterial({ color: '#DDE3EB', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center.x, -0.02, center.z);
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(radius * 6, Math.round(radius * 6), '#C9D1DC', '#D3DAE3');
    grid.position.set(center.x, -0.01, center.z);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);

    // Подписи помещений
    const labels = new THREE.Group();
    for (const u of doc.units) {
      if (u.level !== level) continue;
      const sprite = labelSprite(u.name);
      sprite.position.copy(v3(polygonCentroid(u.polygon), 0.1));
      sprite.name = `label:${u.id}`;
      labels.add(sprite);
    }
    scene.add(labels);

    // Значки мест
    const categories = new Map(doc.categories.map((c) => [c.id, c]));
    const pins = new Map<string, THREE.Sprite>();
    for (const p of doc.places) {
      if (p.level !== level || p.hidden) continue;
      const cat = categories.get(p.category);
      const sprite = pinSprite(cat?.color ?? '#4A5568', cat?.icon ?? '');
      sprite.position.copy(v3(p.pos, 0.08));
      sprite.userData.place = p.id;
      sprite.name = `place:${p.id}`;
      pins.set(p.id, sprite);
      scene.add(sprite);
    }

    // Точки панорам
    const panoMat = new THREE.MeshStandardMaterial({ color: PANORAMA, emissive: PANORAMA, emissiveIntensity: 0.35, roughness: 0.3 });
    for (const p of showPanoramas ? doc.panoramas.filter((pa) => pa.level === level) : []) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), panoMat);
      mesh.position.copy(v3(p.pos, p.cameraHeight));
      mesh.castShadow = true;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, p.cameraHeight, 8), new THREE.MeshStandardMaterial({ color: '#8FB9C6' }));
      stick.position.copy(v3(p.pos, p.cameraHeight / 2));
      scene.add(mesh, stick);
    }

    const routeGroup = new THREE.Group();
    scene.add(routeGroup);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, radius * 20);
    const home = homeView(center, radius);
    camera.position.copy(home.pos);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.minDistance = 4;
    controls.maxDistance = radius * 5;
    controls.autoRotateSpeed = 0.8;
    controls.update();

    const stage: Stage3D = {
      renderer,
      scene,
      camera,
      controls,
      building,
      walls: building.getObjectByName('walls') ? [building.getObjectByName('walls')!] : [],
      lintels: building.getObjectByName('lintels'),
      labels,
      pins,
      routeGroup,
      center,
      radius,
      fly: null,
      walker: null,
    };
    stageRef.current = stage;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      // На узком экране отодвигаем камеру, чтобы этаж помещался по ширине.
      camera.fov = camera.aspect < 0.8 ? 58 : 42;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (stage.fly) {
        const k = 1 - Math.pow(0.001, dt);
        camera.position.lerp(stage.fly.pos, k);
        controls.target.lerp(stage.fly.target, k);
        if (camera.position.distanceTo(stage.fly.pos) < 0.05) stage.fly = null;
      }
      if (stage.walker) {
        stage.walker.t = (stage.walker.t + dt * 0.12) % 1;
        stage.walker.mesh.position.copy(stage.walker.curve.getPointAt(stage.walker.t));
      }
      controls.update();
      renderer.render(scene, camera);
    });

    // Касание значка места — как на плане.
    let down: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      stage.fly = null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects([...pins.values()], false)[0];
      const id = hit?.object.userData.place as string | undefined;
      if (id) clickRef.current?.(id);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    return () => {
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
          // У спрайтов геометрия общая на все экземпляры — её не трогаем.
          if (obj instanceof THREE.Mesh) obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            (m as THREE.SpriteMaterial).map?.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, [doc, level, showPanoramas]);

  // Маршрут: трубка, светящийся «пешеход» и кольцо у цели.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const group = stage.routeGroup;
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    stage.walker = null;
    if (!route || route.length < 2) return;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < route.length; i++) curve.add(new THREE.LineCurve3(v3(route[i - 1]!, 0.22), v3(route[i]!, 0.22)));
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(32, route.length * 24), 0.1, 10, false),
      new THREE.MeshStandardMaterial({ color: ROUTE, emissive: ROUTE, emissiveIntensity: 0.35, roughness: 0.4 }),
    );
    tube.castShadow = true;
    tube.name = 'route';
    const walker = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), new THREE.MeshStandardMaterial({ color: '#FFFFFF', emissive: ROUTE, emissiveIntensity: 0.6 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 12, 48), new THREE.MeshStandardMaterial({ color: '#FF7A1A', emissive: '#FF7A1A', emissiveIntensity: 0.4 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(v3(route[route.length - 1]!, 0.12));
    const start = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 32), new THREE.MeshStandardMaterial({ color: '#12A150' }));
    start.position.copy(v3(route[0]!, 0.1));
    group.add(tube, walker, ring, start);
    stage.walker = { curve, mesh: walker, t: 0 };
  }, [route, doc, level]);

  // Выбранное место — значок крупнее.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const [id, sprite] of stage.pins) {
      const k = id === selectedPlace ? 1.45 : 1;
      sprite.scale.set(1.0 * k, 1.25 * k, 1);
    }
  }, [selectedPlace, doc, level]);

  // Срез стен: низкие стены, чтобы видеть комнаты сверху.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const w of stage.walls) w.scale.y = cut ? CUT_SCALE : 1;
    if (stage.lintels) stage.lintels.visible = !cut;
  }, [cut, doc, level]);

  useEffect(() => {
    if (stageRef.current) stageRef.current.controls.autoRotate = spin;
  }, [spin, doc, level]);

  const flyTo = (kind: 'home' | 'top') => {
    const stage = stageRef.current;
    if (!stage) return;
    const v = kind === 'home' ? homeView(stage.center, stage.radius) : { pos: new THREE.Vector3(stage.center.x, stage.radius * 2.3, stage.center.z + 0.01) };
    stage.fly = { pos: v.pos, target: stage.center.clone() };
  };

  const download = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const exportRoot = stage.building.clone();
    const routeMesh = stage.routeGroup.getObjectByName('route');
    if (routeMesh) exportRoot.add(routeMesh.clone());
    const glb = (await new GLTFExporter().parseAsync(exportRoot, { binary: true })) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.venue.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${level}.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="model3d">
      <div ref={containerRef} className="model3d-canvas" />
      <div className="model3d-tools" style={{ top: (insets?.top ?? 0) + 12 }}>
        <button type="button" className="map-ctl" title="Исходный вид" aria-label="Исходный вид" onClick={() => flyTo('home')}>
          <Icon name="cube" />
        </button>
        <button type="button" className="map-ctl" title="Вид сверху" aria-label="Вид сверху" onClick={() => flyTo('top')}>
          <Icon name="top" />
        </button>
        <button type="button" className="map-ctl" title="Срез стен" aria-label="Срез стен" aria-pressed={cut} onClick={() => setCut((c) => !c)}>
          <Icon name="cut" />
        </button>
        <button type="button" className="map-ctl" title="Вращение" aria-label="Вращение" aria-pressed={spin} onClick={() => setSpin((s) => !s)}>
          <Icon name="rotate" />
        </button>
        <button type="button" className="map-ctl" title="Скачать 3D-модель (.glb)" aria-label="Скачать 3D-модель (.glb)" onClick={download}>
          <Icon name="download" />
        </button>
      </div>
    </div>
  );
}

function homeView(center: THREE.Vector3, radius: number) {
  return { pos: new THREE.Vector3(center.x - radius * 0.35, radius * 1.15, center.z + radius * 1.25) };
}

export default Model3DView;
