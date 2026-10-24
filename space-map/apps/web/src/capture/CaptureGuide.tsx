// Маршрут съёмки на камере (ТЗ 5.4): линия на полу до следующей точки и кольцо, в которое нужно встать.
// Два режима — по тому, что умеет телефон:
// - AR (WebXR, Chrome на Android с ARCore): телефон сам отслеживает, где он, — разметка стоит на полу, пока идёшь;
// - шаги (iPhone и остальные): поворот — по датчику ориентации, продвижение вдоль линии — по шагомеру.
// В обоих режимах направление «мир телефона → план» задаётся один раз прицелом на дверь или место: компас в помещении врёт.
import {
  arFrameFromAim,
  arToPlan,
  azimuth,
  cameraForward,
  captureRoute,
  deviceQuaternion,
  distance,
  hasLineOfSight,
  headingFromAim,
  lineLength,
  nearestOnLine,
  normalize180,
  planToAr,
  pointAlong,
  projectToCamera,
  reanchorArFrame,
  routeOnCamera,
  slerpQuat,
  StepDetector,
  unitAt,
  xrAzimuth,
  type ArFrame,
  type CameraPose,
  type MapDocument,
  type Quat,
  type Vec2,
} from '@space-map/map-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons.tsx';
import { arSupported, ArScene, type XrPose } from './arScene.ts';

/** Телефон держат на уровне глаз. */
const CAMERA_HEIGHT = 1.5;
/** Ближе — «вы на точке». */
const ARRIVE = 0.6;
/** Радиус кольца точки на полу, м. */
const RING = 0.45;

export interface CaptureGuideProps {
  doc: MapDocument;
  level: string;
  /** Человек уже стоит в этой точке; null — начинает от входа. */
  startId: string | null;
  onClose: () => void;
}

type Mode = 'ar' | 'steps';
type Phase = 'intro' | 'aim' | 'guide' | 'done';

interface Landmark {
  pos: Vec2;
  label: string;
}

export default function CaptureGuide({ doc, level, startId, onClose }: CaptureGuideProps) {
  const route = useMemo(() => captureRoute(doc, level), [doc, level]);
  const pointById = useMemo(() => new Map((doc.capturePoints ?? []).map((p) => [p.id, p])), [doc]);
  const firstStep = useMemo(() => {
    if (!startId) return 0;
    const k = route.legs.findIndex((l) => l.to === startId);
    return k < 0 ? 0 : k + 1;
  }, [route, startId]);

  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState(firstStep);
  const [phase, setPhase] = useState<Phase>(firstStep >= route.legs.length ? 'done' : 'intro');
  const [error, setError] = useState<string | null>(null);
  const [arrived, setArrived] = useState(false);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const rootRef = useRef<HTMLDivElement>(null);

  const leg = route.legs[step];
  const target = leg ? pointById.get(leg.to) : undefined;
  const legLength = leg ? lineLength(leg.line) : 0;
  const targetNo = step + 1;
  const room = target ? unitAt(doc, level, target.pos)?.name : undefined;

  // ── AR ──
  const ar = useRef<ArScene | null>(null);
  const [frame, setFrame] = useState<ArFrame | null>(null);
  const [pose, setPose] = useState<XrPose | null>(null);

  // ── Шаги ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rawQ = useRef<Quat | null>(null);
  const smoothQ = useRef<Quat | null>(null);
  const detector = useRef(new StepDetector());
  const legStartSteps = useRef(0);
  const shownAlong = useRef(0);
  const [stepLength, setStepLength] = useState(0.7);
  const [vfov, setVfov] = useState(62);
  const [worldHeading, setWorldHeading] = useState<number | null>(null);
  const [, setTick] = useState(0);
  // Обработчики живут всё время экрана — иначе их не снять при закрытии.
  const onOrientation = useRef((e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    rawQ.current = deviceQuaternion(e.alpha, e.beta, e.gamma, screen.orientation?.angle ?? 0);
  }).current;
  const onMotion = useRef((e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (a?.x == null || a.y == null || a.z == null) return;
    detector.current.push(Math.hypot(a.x, a.y, a.z), e.timeStamp);
  }).current;

  useEffect(() => {
    void arSupported().then((ok) => setMode(ok ? 'ar' : 'steps'));
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ar.current?.dispose();
    };
  }, []);

  // Режим шагов: плавный поворот и плавное продвижение по линии — с частотой экрана.
  useEffect(() => {
    if (mode !== 'steps' || (phase !== 'aim' && phase !== 'guide')) return;
    let id = 0;
    const loop = () => {
      const q = rawQ.current;
      if (q) smoothQ.current = smoothQ.current ? slerpQuat(smoothQ.current, q, 0.22) : q;
      const walked = Math.min(legLength, (detector.current.steps - legStartSteps.current) * stepLength);
      shownAlong.current += (walked - shownAlong.current) * 0.12;
      setTick((t) => (t + 1) % 1_000_000);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [mode, phase, legLength, stepLength]);

  // Где человек на плане сейчас.
  const here: Vec2 | null = !leg
    ? null
    : mode === 'ar'
      ? frame && pose
        ? arToPlan(frame, pose.position)
        : leg.line[0]!
      : pointAlong(leg.line, shownAlong.current);
  const hereKey = here ? `${Math.round(here[0] * 2)}:${Math.round(here[1] * 2)}` : '';
  const landmark = useMemo<Landmark | null>(() => (here ? nearestLandmark(doc, level, here) : null), [doc, level, hereKey]);

  const remaining = (() => {
    if (!here || !target || !leg) return 0;
    if (mode === 'steps') return Math.max(0, legLength - shownAlong.current);
    return hasLineOfSight(doc, level, here, target.pos) ? distance(here, target.pos) : Math.max(distance(here, target.pos), legLength - nearestOnLine(leg.line, here).along);
  })();
  const isArrived = phase === 'guide' && !!target && remaining <= ARRIVE;

  // Дошли — один раз вибрация и зелёное кольцо.
  useEffect(() => {
    if (isArrived === arrived) return;
    setArrived(isArrived);
    ar.current?.setArrived(isArrived);
    if (isArrived) navigator.vibrate?.(80);
  }, [isArrived]);

  // AR: лента маршрута и кольцо — заново при смене отрезка или привязки.
  useEffect(() => {
    const scene = ar.current;
    if (!scene) return;
    if (phase !== 'guide' || !frame || !leg || !target) return scene.setRoute([], null, '');
    scene.setRoute(
      leg.line.map((p) => planToAr(frame, p, 0.015)),
      planToAr(frame, target.pos, 0),
      String(targetNo),
    );
  }, [phase, frame, step]);

  const start = async () => {
    setError(null);
    if (!window.isSecureContext) return setError('Камера и датчики работают только по защищённой ссылке (https).');
    if (mode === 'ar') {
      try {
        const scene = new ArScene(rootRef.current!, {
          onPose: setPose,
          onEnd: () => {
            ar.current = null;
            setFrame(null);
            setPhase((p) => (p === 'done' ? p : 'intro'));
          },
        });
        await scene.start();
        ar.current = scene;
        setPhase('aim');
      } catch {
        setError('AR не запустился на этом телефоне — включили режим по шагам. Нажмите кнопку ещё раз.');
        setMode('steps');
      }
      return;
    }
    try {
      // iOS спрашивает доступ к датчикам только по нажатию кнопки — и ориентацию, и движение.
      for (const E of [DeviceOrientationEvent, DeviceMotionEvent] as unknown as { requestPermission?: () => Promise<string> }[]) {
        if (typeof E.requestPermission === 'function' && (await E.requestPermission()) !== 'granted') {
          return setError('Без доступа к датчикам движения разметку не показать. Разрешите его в настройках браузера.');
        }
      }
      window.addEventListener('deviceorientation', onOrientation);
      window.addEventListener('devicemotion', onMotion);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setPhase(worldHeading === null ? 'aim' : 'guide');
    } catch {
      setError('Не удалось включить камеру. Проверьте, что браузеру разрешён доступ к ней.');
    }
  };

  const aim = () => {
    if (!landmark || !here) return;
    if (mode === 'ar') {
      const scene = ar.current;
      const p = scene?.pose;
      if (!scene || !p) return;
      const floorY = scene.space === 'local-floor' ? 0 : p.position[1] - CAMERA_HEIGHT;
      const next = arFrameFromAim(here, landmark.pos, p.position, p.forward, floorY);
      if (!next) return setError('Держите телефон вертикально, как для фото, и наведите крестик ещё раз.');
      setFrame(next);
    } else {
      const q = smoothQ.current;
      const heading = q ? headingFromAim(q, here, landmark.pos) : null;
      if (heading === null) return setError('Держите телефон вертикально, как для фото, и наведите крестик ещё раз.');
      setWorldHeading(heading);
    }
    setError(null);
    setPhase('guide');
  };

  const next = () => {
    // Человек стоит в точке: AR-привязка сдвигается на неё — накопленный уход обнуляется; шаги — с нуля.
    const p = ar.current?.pose;
    if (mode === 'ar' && frame && p && target) setFrame(reanchorArFrame(frame, p.position, target.pos));
    legStartSteps.current = detector.current.steps;
    shownAlong.current = 0;
    if (step + 1 >= route.legs.length) {
      setPhase('done');
      ar.current?.end();
      return;
    }
    setStep(step + 1);
  };

  const close = () => {
    ar.current?.end();
    onClose();
  };

  // ── Разметка в режиме шагов ──
  const view = { width: size.width, height: size.height, vfov };
  const q = smoothQ.current;
  const camPose: CameraPose | null = mode === 'steps' && q && here && worldHeading !== null ? { pos: here, height: CAMERA_HEIGHT, worldHeading, q } : null;
  const lines = camPose && leg ? routeOnCamera(doc, level, camPose, view, leg.line) : [];
  const ring = camPose && target ? ringOnCamera(camPose, view, target.pos) : null;
  const pin = camPose && target ? projectToCamera(camPose, view, target.pos, 1.3) : null;
  const pinOnScreen = !!pin && pin.x > 24 && pin.x < size.width - 24 && pin.y > 90 && pin.y < size.height - 140;

  // Куда повернуться, если точка за кадром.
  let turn: 'left' | 'right' | null = null;
  if (phase === 'guide' && here && target && leg && !isArrived) {
    const facing =
      mode === 'ar' && frame && pose
        ? xrAzimuth(pose.forward) + frame.delta
        : camPose
          ? (() => {
              const f = cameraForward(camPose.q);
              return (Math.atan2(f[0], f[1]) * 180) / Math.PI + camPose.worldHeading;
            })()
          : null;
    if (facing !== null) {
      const towards = firstVisible(doc, level, here, leg.line) ?? target.pos;
      const diff = normalize180(azimuth(here, towards) - facing);
      if (Math.abs(diff) > 40) turn = diff > 0 ? 'right' : 'left';
    }
  }

  const inAr = mode === 'ar' && phase !== 'intro' && phase !== 'done';

  return (
    <div ref={rootRef} className={`guide ${inAr ? 'is-ar' : ''}`} role="dialog" aria-label="Маршрут съёмки">
      {mode === 'steps' && <video ref={videoRef} className="guide-video" playsInline muted autoPlay />}

      {phase === 'guide' && mode === 'steps' && (
        <svg className="guide-overlay" width={size.width} height={size.height} aria-hidden>
          {lines.map((line, i) => {
            const pts = line.map((p) => p.join(',')).join(' ');
            return (
              <g key={i}>
                <polyline points={pts} className="guide-route-casing" />
                <polyline points={pts} className="guide-route" />
                <polyline points={pts} className="guide-route-flow" />
              </g>
            );
          })}
          {ring && (
            <g className={isArrived ? 'is-arrived' : undefined}>
              <polygon points={ring} className="guide-ring-fill" />
              <polygon points={ring} className="guide-ring-wave" />
              <polygon points={ring} className="guide-ring" />
            </g>
          )}
          {pin && pinOnScreen && (
            <g transform={`translate(${pin.x} ${pin.y})`} className={`guide-pin ${isArrived ? 'is-arrived' : ''}`}>
              <circle r={17} />
              <text y={6} textAnchor="middle">
                {isArrived ? '✓' : targetNo}
              </text>
            </g>
          )}
        </svg>
      )}

      {(phase === 'aim' || phase === 'guide') && <div className={`guide-cross ${phase === 'guide' ? 'is-faint' : ''}`} aria-hidden />}

      <div className="guide-top">
        <button type="button" className="glass-btn" onClick={close}>
          <Icon name="back" size={18} />К плану
        </button>
        {phase === 'guide' && route.legs.length > 0 && (
          <span className="glass-title">
            Точка {targetNo} из {route.legs.length}
          </span>
        )}
        {mode && phase !== 'intro' && phase !== 'done' && <span className="guide-mode">{mode === 'ar' ? 'AR' : 'По шагам'}</span>}
      </div>

      {phase === 'guide' && target && (
        <div className={`guide-hud ${isArrived ? 'is-arrived' : ''}`} aria-live="polite">
          {isArrived ? (
            <>
              <strong>Вы на точке {targetNo}</strong>
              <span>Встаньте в центр кольца и снимите панораму</span>
            </>
          ) : (
            <>
              <strong>{fmtMeters(remaining)}</strong>
              <span>до точки {targetNo}{room ? ` · ${room}` : ''}</span>
            </>
          )}
        </div>
      )}

      {turn && (
        <div className={`guide-turn is-${turn}`} aria-live="polite">
          <Icon name="back" size={26} />
          {turn === 'left' ? 'Поверните налево' : 'Поверните направо'}
        </div>
      )}

      <div className="guide-panel" key={phase}>
        {phase === 'intro' && (
          <>
            <h2>Маршрут съёмки</h2>
            <p>
              {route.legs.length === 0
                ? 'Все точки уже сняты.'
                : `${route.legs.length} ${plural(route.legs.length, 'точка', 'точки', 'точек')} по порядку, всего ≈ ${Math.round(route.length)} м. На камере будет линия на полу до следующей точки и кольцо, в которое нужно встать.`}
            </p>
            {mode && (
              <p className="hint">
                {mode === 'ar'
                  ? 'Телефон сам отслеживает, где вы: разметка остаётся на полу, пока вы идёте.'
                  : 'Этот телефон не умеет AR — разметка движется по шагам. Идите по линии ровным шагом, телефон держите перед собой.'}{' '}
                {firstStep === 0 ? 'Встаньте у входа.' : 'Встаньте в выбранную точку.'}
              </p>
            )}
            {route.legs.length > 0 && (
              <button type="button" className="btn btn-primary btn-block" disabled={!mode} onClick={() => void start()}>
                <Icon name="camera" size={18} /> {mode === 'ar' ? 'Включить AR' : 'Включить камеру'}
              </button>
            )}
          </>
        )}
        {phase === 'aim' && (
          <>
            <h2>Наведите крестик</h2>
            {landmark ? (
              <p>
                Наведите крестик на <b>{landmark.label}</b> и нажмите «Навёл» — так телефон поймёт, куда смотрит план.
              </p>
            ) : (
              <p>Рядом на плане нет дверей и мест, на которые можно навестись. Отойдите к двери и начните снова.</p>
            )}
            <button type="button" className="btn btn-primary btn-block" disabled={!landmark || (mode === 'ar' ? !pose : !smoothQ.current)} onClick={aim}>
              Навёл
            </button>
          </>
        )}
        {phase === 'guide' && leg && (
          <>
            <p className="guide-step">
              {isArrived
                ? 'Снимите панораму, затем нажмите «Снято — дальше».'
                : mode === 'ar'
                  ? 'Идите по фиолетовой линии к кольцу.'
                  : `Идите по линии ровным шагом — разметка движется по шагам (${detector.current.steps - legStartSteps.current}).`}
            </p>
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('aim')}>
                Сбилось
              </button>
              <button type="button" className={`btn ${isArrived ? 'btn-success' : 'btn-primary'}`} onClick={next}>
                {step + 1 >= route.legs.length ? 'Снято — готово' : 'Снято — дальше'}
              </button>
            </div>
            {mode === 'steps' && (
              <details className="guide-settings">
                <summary>Разметка не совпадает с полом</summary>
                <label>
                  <span>Угол обзора камеры · {vfov}°</span>
                  <input type="range" min={40} max={90} value={vfov} onChange={(e) => setVfov(Number(e.target.value))} />
                </label>
                <label>
                  <span>Длина шага · {Math.round(stepLength * 100)} см</span>
                  <input type="range" min={45} max={95} value={Math.round(stepLength * 100)} onChange={(e) => setStepLength(Number(e.target.value) / 100)} />
                </label>
              </details>
            )}
          </>
        )}
        {phase === 'done' && (
          <>
            <h2>Маршрут пройден</h2>
            <p>Все точки по плану обойдены. Загрузите снятые панорамы — они встанут в свои точки.</p>
            <button type="button" className="btn btn-primary btn-block" onClick={close}>
              К плану
            </button>
          </>
        )}
        {error && <p className="notice">{error}</p>}
      </div>
    </div>
  );
}

/** Кольцо точки на полу в перспективе: многоугольник по точкам окружности; null — кольцо не целиком в кадре. */
function ringOnCamera(pose: CameraPose, view: { width: number; height: number; vfov: number }, center: Vec2): string | null {
  const pts: string[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const s = projectToCamera(pose, view, [center[0] + Math.cos(a) * RING, center[1] + Math.sin(a) * RING]);
    if (!s) return null;
    pts.push(`${Math.round(s.x * 10) / 10},${Math.round(s.y * 10) / 10}`);
  }
  return pts.join(' ');
}

/** На что навести прицел: ближайшая видимая дверь или место не ближе 1,5 м. */
function nearestLandmark(doc: MapDocument, level: string, from: Vec2): Landmark | null {
  const unitName = (id: string) => doc.units.find((u) => u.id === id)?.name ?? '';
  const here = unitAt(doc, level, from);
  const candidates: Landmark[] = [
    ...doc.openings
      .filter((o) => o.level === level)
      .map((o) => {
        const other = o.units.find((u) => u !== here?.id);
        const label = o.kind === 'entrance' ? 'середину входа с улицы' : other ? `середину двери в «${unitName(other)}»` : 'середину двери';
        return { pos: [(o.segment[0][0] + o.segment[1][0]) / 2, (o.segment[0][1] + o.segment[1][1]) / 2] as Vec2, label };
      }),
    ...doc.places.filter((p) => p.level === level && !p.hidden).map((p) => ({ pos: p.pos, label: `«${p.name}»` })),
  ];
  let best: Landmark | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(from, c.pos);
    if (d >= 1.5 && d < bestD && hasLineOfSight(doc, level, from, c.pos)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** Последняя точка линии, видимая отсюда, — туда и поворачиваться, если цель за углом. */
function firstVisible(doc: MapDocument, level: string, from: Vec2, line: Vec2[]): Vec2 | null {
  const start = nearestOnLine(line, from).segment + 1;
  let last: Vec2 | null = null;
  for (const p of line.slice(start)) {
    if (!hasLineOfSight(doc, level, from, p)) break;
    last = p;
  }
  return last;
}

function fmtMeters(m: number): string {
  return m < 10 ? `${(Math.round(m * 10) / 10).toLocaleString('ru-RU')} м` : `${Math.round(m)} м`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
