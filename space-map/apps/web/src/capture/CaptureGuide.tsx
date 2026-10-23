// Маршрут съёмки на камере (ТЗ 5.4): видео с задней камеры, поверх — линия маршрута на полу и следующая точка.
// Человек стоит в известной точке плана и только поворачивается — хватает ориентации телефона (3 степени свободы).
// Направление «мир датчиков → план» задаётся один раз прицелом на дверь: компас в помещении врёт.
import {
  captureRoute,
  distance,
  hasLineOfSight,
  headingFromAim,
  projectToCamera,
  routeOnCamera,
  unitAt,
  cameraForward,
  azimuth,
  normalize180,
  deviceQuaternion,
  type CameraPose,
  type MapDocument,
  type Quat,
  type Vec2,
} from '@space-map/map-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons.tsx';

/** Телефон держат на уровне глаз. */
const CAMERA_HEIGHT = 1.5;

export interface CaptureGuideProps {
  doc: MapDocument;
  level: string;
  /** Человек уже стоит в этой точке; null — начинает от входа. */
  startId: string | null;
  onClose: () => void;
}

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
  const [step, setStep] = useState(firstStep);
  const [phase, setPhase] = useState<Phase>(firstStep >= route.legs.length ? 'done' : 'intro');
  const [error, setError] = useState<string | null>(null);
  const [vfov, setVfov] = useState(62);
  const [worldHeading, setWorldHeading] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const orientation = useRef<Quat | null>(null);
  // Один и тот же обработчик на всё время жизни экрана — иначе его не снять при закрытии.
  const onOrientation = useRef((e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    orientation.current = deviceQuaternion(e.alpha, e.beta, e.gamma, screen.orientation?.angle ?? 0);
  }).current;
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const leg = route.legs[step];
  // Где стоит человек: старт маршрута или точка, куда вёл предыдущий отрезок.
  const standPos: Vec2 | null = leg ? leg.line[0]! : null;
  const target = leg ? pointById.get(leg.to) : undefined;
  const targetNo = step + 1;

  const landmark = useMemo<Landmark | null>(() => (standPos ? nearestLandmark(doc, level, standPos) : null), [doc, level, standPos?.[0], standPos?.[1]]);

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Камера и датчики выключаются, как только экран закрыт (ТЗ 5.4, п. 45).
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      window.removeEventListener('deviceorientation', onOrientation);
    },
    [],
  );

  // Перерисовка разметки с частотой экрана, пока на неё смотрят.
  useEffect(() => {
    if (phase !== 'guide' && phase !== 'aim') return;
    let id = 0;
    const tick = () => {
      setFrame((f) => (f + 1) % 1_000_000);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const start = async () => {
    setError(null);
    if (!window.isSecureContext) return setError('Камера и датчики работают только по защищённой ссылке (https).');
    try {
      // iOS спрашивает доступ к датчикам только по нажатию кнопки.
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
      if (typeof DOE.requestPermission === 'function' && (await DOE.requestPermission()) !== 'granted') {
        return setError('Без доступа к датчикам движения разметку не показать. Разрешите его в настройках браузера.');
      }
      window.addEventListener('deviceorientation', onOrientation);
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

  const q = orientation.current;
  const noSensor = (phase === 'aim' || phase === 'guide') && frame > 90 && !q;

  const aim = () => {
    if (!q || !standPos || !landmark) return;
    const heading = headingFromAim(q, standPos, landmark.pos);
    if (heading === null) return setError('Держите телефон вертикально, как для фото, и наведите крестик ещё раз.');
    setError(null);
    setWorldHeading(heading);
    setPhase('guide');
  };

  const next = () => {
    if (step + 1 >= route.legs.length) return setPhase('done');
    setStep(step + 1);
  };

  // ── Разметка ──
  const view = { width: size.width, height: size.height, vfov };
  const pose: CameraPose | null = q && standPos && worldHeading !== null ? { pos: standPos, height: CAMERA_HEIGHT, worldHeading, q } : null;
  const lines = pose && leg ? routeOnCamera(doc, level, pose, view, leg.line) : [];
  const marker = pose && target ? projectToCamera(pose, view, target.pos) : null;
  const onScreen = marker && marker.x > 24 && marker.x < size.width - 24 && marker.y > 80 && marker.y < size.height - 24;
  // Цель за кадром — подсказка, куда повернуться.
  let turn: 'left' | 'right' | null = null;
  if (pose && target && !onScreen) {
    const f = cameraForward(pose.q);
    const facing = (Math.atan2(f[0], f[1]) * 180) / Math.PI + pose.worldHeading;
    turn = normalize180(azimuth(pose.pos, firstVisible(doc, level, pose.pos, leg!.line) ?? target.pos) - facing) > 0 ? 'right' : 'left';
  }
  const legDistance = leg ? Math.round(leg.length) : 0;
  const room = target ? unitAt(doc, level, target.pos)?.name : undefined;

  return (
    <div className="guide" role="dialog" aria-label="Маршрут съёмки">
      <video ref={videoRef} className="guide-video" playsInline muted autoPlay />

      {phase === 'guide' && (
        <svg className="guide-overlay" width={size.width} height={size.height} aria-hidden>
          {lines.map((line, i) => (
            <g key={i}>
              <polyline points={line.map((p) => p.join(',')).join(' ')} className="guide-route-casing" />
              <polyline points={line.map((p) => p.join(',')).join(' ')} className="guide-route" />
            </g>
          ))}
          {marker && onScreen && (
            <g transform={`translate(${marker.x} ${marker.y})`}>
              <ellipse rx={Math.max(10, 260 / marker.depth)} ry={Math.max(4, 90 / marker.depth)} className="guide-target-ring" />
              <circle r={15} cy={-34} className="guide-target-dot" />
              <text y={-29} textAnchor="middle" className="guide-target-label">
                {targetNo}
              </text>
            </g>
          )}
        </svg>
      )}

      {(phase === 'aim' || phase === 'guide') && <div className="guide-cross" aria-hidden />}

      <div className="guide-top">
        <button type="button" className="glass-btn" onClick={onClose}>
          <Icon name="back" size={18} />К плану
        </button>
        {phase === 'guide' && <span className="glass-title">{`Точка ${targetNo} из ${route.legs.length}`}</span>}
      </div>

      {turn && phase === 'guide' && (
        <div className={`guide-turn is-${turn}`} aria-live="polite">
          <Icon name="back" size={30} />
          {turn === 'left' ? 'Поверните налево' : 'Поверните направо'}
        </div>
      )}

      <div className="guide-panel">
        {phase === 'intro' && (
          <>
            <h2>Маршрут съёмки</h2>
            <p>
              {route.legs.length === 0
                ? 'Все точки уже сняты.'
                : `${route.legs.length} ${route.legs.length === 1 ? 'точка' : 'точки'} по порядку, всего ≈ ${Math.round(route.length)} м. На камере будет линия на полу до следующей точки.`}
            </p>
            <p className="hint">
              {firstStep === 0 ? 'Встаньте у входа.' : 'Встаньте в выбранную точку.'} Разметка точна, пока вы стоите в точке и поворачиваетесь; на ходу она
              отстаёт — у браузера нет отслеживания шагов.
            </p>
            {route.legs.length > 0 && (
              <button type="button" className="btn btn-primary btn-block" onClick={() => void start()}>
                <Icon name="camera" size={18} /> Включить камеру
              </button>
            )}
          </>
        )}
        {phase === 'aim' && (
          <>
            <h2>Где вы стоите</h2>
            {landmark ? (
              <p>
                Наведите крестик на <b>{landmark.label}</b> и нажмите «Навёл». Так телефон поймёт, куда смотрит план.
              </p>
            ) : (
              <p>Рядом на плане нет дверей и мест, на которые можно навестись. Отойдите к двери и начните снова.</p>
            )}
            <button type="button" className="btn btn-primary btn-block" disabled={!q || !landmark} onClick={aim}>
              Навёл
            </button>
          </>
        )}
        {phase === 'guide' && leg && (
          <>
            <h2>
              Идите к точке {targetNo}
              {room ? ` · ${room}` : ''}
            </h2>
            <p>{`≈ ${legDistance} м по линии. Встаньте в кольцо и снимите панораму, затем нажмите «Я на месте».`}</p>
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('aim')}>
                Направление сбилось
              </button>
              <button type="button" className="btn btn-primary" onClick={next}>
                Я на месте
              </button>
            </div>
            <label className="guide-fov">
              <span>Линия не совпадает с полом — подстройте угол камеры</span>
              <input type="range" min={40} max={90} value={vfov} onChange={(e) => setVfov(Number(e.target.value))} />
            </label>
          </>
        )}
        {phase === 'done' && (
          <>
            <h2>Маршрут пройден</h2>
            <p>Все точки по плану обойдены. Загрузите снятые панорамы — они встанут в свои точки.</p>
            <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
              К плану
            </button>
          </>
        )}
        {noSensor && <p className="notice">Датчик ориентации не отвечает. На этом устройстве разметку не показать — снимайте по плану.</p>}
        {error && <p className="notice">{error}</p>}
      </div>
    </div>
  );
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

/** Последняя видимая точка начала линии — туда и поворачиваться, если цель за углом. */
function firstVisible(doc: MapDocument, level: string, from: Vec2, line: Vec2[]): Vec2 | null {
  let last: Vec2 | null = null;
  for (const p of line.slice(1)) {
    if (!hasLineOfSight(doc, level, from, p)) break;
    last = p;
  }
  return last;
}
