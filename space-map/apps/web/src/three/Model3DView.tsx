// 3D-вид этажа (ТЗ 5.18): модель строится из плана, без внешних файлов, и выгружается в glTF (.glb).
import { buildModel3D, type MapDocument, type Vec2 } from '@space-map/map-core';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { UNIT_FILL } from '../plan/style.ts';

export interface Model3DViewProps {
  doc: MapDocument;
  level: string;
  route?: Vec2[] | null;
}

const WALL_THICKNESS = 0.12;

// План (x, y) → three (x, −z): y плана уходит «вглубь», ось three Y — вверх.
const v3 = (p: Vec2, h = 0) => new THREE.Vector3(p[0], h, -p[1]);

export function buildScene(doc: MapDocument, level: string, route?: Vec2[] | null): THREE.Group {
  const model = buildModel3D(doc, level);
  const root = new THREE.Group();
  root.name = doc.venue.name;

  for (const floor of model.floors) {
    const shape = new THREE.Shape(floor.polygon.map((p) => new THREE.Vector2(p[0], p[1])));
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({ color: UNIT_FILL[floor.kind as keyof typeof UNIT_FILL] ?? '#F1F5F9', side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2; // Shape лежит в XY → кладём на пол (XZ), y плана → −z
    mesh.name = `floor:${floor.unit}`;
    root.add(mesh);
  }

  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#E2E8F0' });
  for (const [i, w] of model.walls.entries()) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_THICKNESS, w.height, WALL_THICKNESS), wallMaterial);
    const mid: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    mesh.position.copy(v3(mid, w.height / 2));
    mesh.rotation.y = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
    mesh.name = `wall:${i}`;
    root.add(mesh);
  }

  const blockMaterial = new THREE.MeshStandardMaterial({ color: '#94A3B8' });
  for (const b of model.blocks) {
    const shape = new THREE.Shape(b.polygon.map((p) => new THREE.Vector2(p[0], p[1])));
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false }), blockMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.name = `block:${b.id}`;
    root.add(mesh);
  }

  const panoMaterial = new THREE.MeshStandardMaterial({ color: '#0EA5E9', emissive: '#0369A1' });
  for (const p of doc.panoramas.filter((pa) => pa.level === level)) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16), panoMaterial);
    mesh.position.copy(v3(p.pos, p.cameraHeight));
    mesh.name = `panorama:${p.id}`;
    root.add(mesh);
  }

  if (route && route.length > 1) {
    const curve = new THREE.CatmullRomCurve3(route.map((p) => v3(p, 0.15)), false, 'catmullrom', 0);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, route.length * 16, 0.12, 8), new THREE.MeshStandardMaterial({ color: '#1D4ED8' }));
    tube.name = 'route';
    root.add(tube);
  }
  return root;
}

export function Model3DView({ doc, level, route }: Model3DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#F8FAFC');
    scene.add(new THREE.HemisphereLight('#FFFFFF', '#CBD5E1', 2.2));
    const sun = new THREE.DirectionalLight('#FFFFFF', 1.6);
    sun.position.set(20, 40, 10);
    scene.add(sun);

    const model = buildScene(doc, level, route);
    sceneRef.current = model;
    scene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(center.x + radius * 0.6, radius * 1.2, center.z + radius * 1.1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.update();

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [doc, level, route]);

  const download = async () => {
    if (!sceneRef.current) return;
    const glb = (await new GLTFExporter().parseAsync(sceneRef.current, { binary: true })) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.venue.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${level}.glb`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="model3d">
      <div ref={containerRef} className="model3d-canvas" />
      <button type="button" className="btn btn-secondary model3d-download" onClick={download}>
        Скачать 3D-модель (.glb)
      </button>
    </div>
  );
}

export default Model3DView;
