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
  type ShotPanorama,
  type Vec2,
} from '@space-map/map-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, venuesApi } from '../api.ts';
import { Icon } from '../ui/icons.tsx';
import { arSupported, ArScene, ArStartError, type SphereProgress, type XrPose } from './arScene.ts';
import { APP_NAME, APP_REPO, appIntentUrl, isAndroid } from './externalApp.ts';

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
  /** Площадка на сервере — туда уходят снятые фотосферы; null — демо без сервера, фотосфера скачивается файлом. */
  venueId: string | null;
  /** Фотосфера сохранена на сервере — поставить её на план. */
  onPanorama: (shot: ShotPanorama) => void;
  onClose: () => void;
}

type Mode = 'ar' | 'steps';
/** external — снимаем фотосферу в приложении 360 и ждём файл обратно. */
type Phase = 'intro' | 'aim' | 'guide' | 'sphere' | 'external' | 'done';

/** Готово, если снято столько сферы; раньше можно, но дыры будут заметны. */
const SPHERE_DONE = 0.97;
const SPHERE_MIN = 0.85;

interface Landmark {
  pos: Vec2;
  label: string;
}

export default function CaptureGuide({ doc, level, startId, venueId, onPanorama, onClose }: CaptureGuideProps) {
  // Маршрут считается один раз: снятые точки выпадают из плана съёмки, но порядок обхода не должен прыгать.
  const [route] = useState(() => captureRoute(doc, level));
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
  /** Почему не запустился AR — имя ошибки браузера; показываем, что с ней делать, и даём выбор. */
  const [arFailure, setArFailure] = useState<string | null>(null);
  const [arrived, setArrived] = useState(false);
  const [sphere, setSphere] = useState<SphereProgress | null>(null);
  const [flash, setFlash] = useState(0);
  const [saving, setSaving] = useState(false);
  /** Фотосфера в этой точке уже сохранена. */
  const [savedHere, setSavedHere] = useState(false);
  /** Привязку ставим заново из этой точки плана (человек точно в ней), а не из оценки положения. */
  const [standAt, setStandAt] = useState<Vec2 | null>(null);
  /** Почему просим навести крестик ещё раз. */
  const [aimReason, setAimReason] = useState<'shot' | 'jump' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
  const aimFrom = standAt ?? here;
  const aimKey = aimFrom ? `${Math.round(aimFrom[0] * 2)}:${Math.round(aimFrom[1] * 2)}` : '';
  const landmark = useMemo<Landmark | null>(() => (aimFrom ? nearestLandmark(doc, level, aimFrom) : null), [doc, level, aimKey]);

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

  /** Запуск камеры. `forceAim` — после перерыва (съёмка в другом приложении) направление ставим заново. */
  const start = async (forceAim = false) => {
    setError(null);
    setArFailure(null);
    if (!window.isSecureContext) return setError('Камера и датчики работают только по защищённой ссылке (https).');
    if (mode === 'ar') {
      try {
        const scene = new ArScene(rootRef.current!, {
          onPose: setPose,
          onSphere: setSphere,
          onShot: () => {
            setFlash((f) => f + 1);
            navigator.vibrate?.(15);
          },
          // Мир AR сдвинулся на ходу — линия поехала бы не туда; просим навести крестик заново с последнего верного места.
          onJump: () =>
            setPhase((p) => {
              if (p !== 'guide') return p;
              setAimReason('jump');
              return 'aim';
            }),
          onEnd: () => {
            ar.current = null;
            setFrame(null);
            // Ушли снимать в приложение 360 — AR закрылся сам, экран ждёт файл.
            setPhase((p) => (p === 'done' || p === 'external' ? p : 'intro'));
          },
        });
        await scene.start();
        ar.current = scene;
        setPhase('aim');
      } catch (err) {
        setArFailure(err instanceof ArStartError ? err.code : 'Error');
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setPhase(forceAim || worldHeading === null ? 'aim' : 'guide');
    } catch {
      setError('Не удалось включить камеру. Проверьте, что браузеру разрешён доступ к ней.');
    }
  };

  const aim = () => {
    if (!landmark || !aimFrom) return;
    if (mode === 'ar') {
      const scene = ar.current;
      const p = scene?.pose;
      if (!scene || !p) return;
      const floorY = scene.space === 'local-floor' ? 0 : p.position[1] - CAMERA_HEIGHT;
      const next = arFrameFromAim(aimFrom, landmark.pos, p.position, p.forward, floorY);
      if (!next) return setError('Держите телефон вертикально, как для фото, и наведите крестик ещё раз.');
      setFrame(next);
    } else {
      const q = smoothQ.current;
      const heading = q ? headingFromAim(q, aimFrom, landmark.pos) : null;
      if (heading === null) return setError('Держите телефон вертикально, как для фото, и наведите крестик ещё раз.');
      setWorldHeading(heading);
    }
    setError(null);
    setStandAt(null);
    setAimReason(null);
    setPhase('guide');
  };

  const next = () => {
    // Человек стоит в точке: AR-привязка сдвигается на неё — накопленный уход обнуляется; шаги — с нуля.
    const p = ar.current?.pose;
    if (mode === 'ar' && frame && p && target) setFrame(reanchorArFrame(frame, p.position, target.pos));
    legStartSteps.current = detector.current.steps;
    shownAlong.current = 0;
    const shot = savedHere;
    setSavedHere(false);
    if (step + 1 >= route.legs.length) {
      setPhase('done');
      ar.current?.end();
      return;
    }
    setStep(step + 1);
    // Пока снимали сферу, ARCore мог сдвинуть мир — привязку ставим заново, стоя ровно в точке.
    if (shot && mode === 'ar' && target) {
      setStandAt(target.pos);
      setAimReason('shot');
      setPhase('aim');
    }
  };

  const close = () => {
    ar.current?.end();
    onClose();
  };

  // ── Фотосфера ──
  const startSphere = () => {
    const scene = ar.current;
    if (!scene?.pose) return;
    if (!scene.cameraAccess) return setError('Браузер не дал кадры камеры для съёмки — загрузите готовую панораму.');
    setError(null);
    setSphere(null);
    scene.startSphere(frame ? frame.floorY : scene.space === 'local-floor' ? 0 : scene.pose.position[1] - CAMERA_HEIGHT);
    setPhase('sphere');
  };

  const cancelSphere = () => {
    ar.current?.cancelSphere();
    setPhase('guide');
  };

  /** Фотосфера готова: на сервер и на план; в демо без сервера — файлом на телефон. `pos` — где стояли, по умолчанию оценка положения. */
  const saveShot = async (blob: Blob, heading: number | null, cameraHeight: number, at: Vec2 | null = here) => {
    if (!target || !at) return;
    if (!venueId) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `фотосфера-${targetNo}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return setError('Это демо без сервера: фотосфера скачана файлом. Чтобы она встала на план, снимайте в площадке из кабинета.');
    }
    setSaving(true);
    try {
      const asset = await venuesApi.uploadPanorama(venueId, new File([blob], `sphere-${targetNo}.jpg`, { type: blob.type || 'image/jpeg' }));
      onPanorama({ pointId: target.id, pano: asset.id, level, pos: at, heading, cameraHeight });
      setSavedHere(true);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить фотосферу — проверьте связь и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  /** Снимать в приложении 360: AR не переживёт переход в другое приложение — закрываем его и ждём файл обратно. */
  const openExternal = () => {
    setPhase('external');
    ar.current?.end();
    window.location.href = appIntentUrl();
  };

  /** После съёмки в приложении: к следующей точке — заново камера и прицел, стоя ровно в этой точке. */
  const continueRoute = async () => {
    legStartSteps.current = detector.current.steps;
    shownAlong.current = 0;
    const at = target?.pos ?? null;
    setSavedHere(false);
    if (step + 1 >= route.legs.length) return setPhase('done');
    setStep(step + 1);
    setStandAt(at);
    setAimReason('shot');
    setFrame(null);
    await start(true);
  };

  const finishSphere = async () => {
    const scene = ar.current;
    const p = scene?.pose;
    if (!scene || !frame || !p) return;
    setSaving(true);
    try {
      const { blob } = await scene.finishSphere();
      setPhase('guide');
      // Центр панорамы — ось «вперёд» мира AR, а её азимут на плане даёт привязка: поворачивать по двери не нужно.
      await saveShot(blob, frame.delta, Math.min(2.2, Math.max(0.8, p.position[1] - frame.floorY)));
    } catch {
      setError('Не удалось собрать фотосферу — попробуйте снять ещё раз.');
      setSaving(false);
    }
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
  const spherePct = Math.round((sphere?.fraction ?? 0) * 100);
  const sphereText = !sphere
    ? 'Медленно поворачивайтесь на месте — кадры снимаются сами'
    : sphere.noCamera
      ? 'Браузер не даёт кадры камеры — загрузите готовую панораму'
      : sphere.lost
        ? 'Телефону не за что зацепиться — захватите в кадр угол, дверь, мебель или пол'
        : sphere.moved
          ? 'Вернитесь на место: поворачивайтесь вокруг телефона, не шагайте'
          : sphere.fraction >= SPHERE_DONE
          ? 'Готово — можно сохранять'
            : !sphere.steady
              ? 'Медленнее — кадр снимется, когда телефон замрёт'
              : sphere.far
                ? 'Держите телефон ближе к себе — поворачивайтесь на месте'
                : sphere.weak
                  ? 'Мало деталей — снимаем по гироскопу, поворачивайтесь медленно и плавно'
                  : sphere.hint
                  ? { left: 'Поверните левее, на фиолетовые точки', right: 'Поверните правее, на фиолетовые точки', up: 'Наклоните вверх — снимите потолок', down: 'Наклоните вниз — снимите пол' }[sphere.hint]
                  : 'Держите — снимаем';

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

      {(phase === 'aim' || phase === 'guide' || phase === 'sphere') && <div className={`guide-cross ${phase === 'guide' ? 'is-faint' : ''}`} aria-hidden />}
      {phase === 'sphere' && flash > 0 && <div key={flash} className="guide-flash" aria-hidden />}
      {phase === 'sphere' && sphere?.hint && sphere.fraction < SPHERE_DONE && !sphere.moved && !sphere.lost && !sphere.home && (
        <div className={`guide-tilt is-${sphere.hint}`} aria-hidden>
          <Icon name="back" size={30} />
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Загруженная панорама — в саму точку: человек стоял в кольце, а направление зададут по двери.
          if (f) void saveShot(f, null, CAMERA_HEIGHT, target?.pos ?? null);
          e.target.value = '';
        }}
      />

      <div className="guide-top">
        <button type="button" className="glass-btn" onClick={close}>
          <Icon name="back" size={18} />К плану
        </button>
        {(phase === 'guide' || phase === 'sphere') && route.legs.length > 0 && (
          <span className="glass-title">
            Точка {targetNo} из {route.legs.length}
          </span>
        )}
        {mode && phase !== 'intro' && phase !== 'done' && <span className="guide-mode">{mode === 'ar' ? 'AR' : 'По шагам'}</span>}
      </div>

      {phase === 'sphere' && (
        <div className={`guide-hud ${(sphere?.fraction ?? 0) >= SPHERE_DONE ? 'is-arrived' : ''}`} aria-live="polite">
          <strong>{spherePct} %</strong>
          <span>{sphereText}</span>
        </div>
      )}

      {phase === 'guide' && target && (
        <div className={`guide-hud ${isArrived || savedHere ? 'is-arrived' : ''}`} aria-live="polite">
          {savedHere ? (
            <>
              <strong>Фотосфера сохранена</strong>
              <span>Она уже стоит в точке {targetNo} на плане</span>
            </>
          ) : isArrived ? (
            <>
              <strong>Вы на точке {targetNo}</strong>
              <span>Встаньте в центр кольца и снимите фотосферу</span>
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
            {inAppBrowser() && (
              <p className="notice">
                Похоже, ссылка открыта во встроенном браузере приложения — AR там часто не работает. Откройте её в самом Chrome: ⋮ → «Открыть в
                браузере».
              </p>
            )}
            {arFailure ? (
              <>
                <p className="notice">
                  {arFailureText(arFailure)} <small className="guide-code">Код: {arFailure}</small>
                </p>
                {/* В Play Маркете «Сервисы Google Play для AR» видны только на поддерживаемых телефонах — прямая ссылка отвечает сразу. */}
                <a className="btn btn-ghost btn-block" href="https://play.google.com/store/apps/details?id=com.google.ar.core" target="_blank" rel="noreferrer">
                  Проверить AR в Play Маркете
                </a>
                <p className="hint">«Не поддерживается на вашем устройстве» — значит, AR на этом телефоне не будет, снимайте по шагам.</p>
                <div className="row">
                  <button type="button" className="btn btn-secondary" onClick={() => void start(false)}>
                    Ещё раз AR
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setArFailure(null);
                      setMode('steps');
                    }}
                  >
                    По шагам
                  </button>
                </div>
              </>
            ) : (
              route.legs.length > 0 && (
                <button type="button" className="btn btn-primary btn-block" disabled={!mode} onClick={() => void start(false)}>
                  <Icon name="camera" size={18} /> {mode === 'ar' ? 'Включить AR' : 'Включить камеру'}
                </button>
              )
            )}
          </>
        )}
        {phase === 'aim' && (
          <>
            <h2>Наведите крестик</h2>
            {aimReason === 'shot' && <p className="hint">Пока снимали фотосферу, телефон мог сбиться — уточним направление, чтобы линия к следующей точке легла верно.</p>}
            {aimReason === 'jump' && <p className="hint">Телефон заново нашёл опору и сдвинул разметку — уточним направление.</p>}
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
              {savedHere
                ? 'Посмотреть её можно потом: «К плану» → точка с галочкой → «Открыть панораму».'
                : isArrived
                  ? mode === 'ar'
                    ? 'Встаньте в кольцо и снимите фотосферу: телефон на уровне глаз, поворачивайтесь на месте.'
                    : 'Снимите фотосферу приложением или 360-камерой и загрузите её сюда.'
                  : mode === 'ar'
                    ? 'Идите по фиолетовой линии к кольцу.'
                    : `Идите по линии ровным шагом — разметка движется по шагам (${detector.current.steps - legStartSteps.current}).`}
            </p>
            {isArrived && !savedHere && (
              <div className="guide-shoot">
                {isAndroid() && (
                  <button type="button" className="btn btn-success btn-block" disabled={saving} onClick={openExternal}>
                    <Icon name="camera" size={18} /> Снять приложением 360
                  </button>
                )}
                <div className="row">
                  {mode === 'ar' && (
                    <button type="button" className={`btn ${isAndroid() ? 'btn-secondary' : 'btn-success'}`} disabled={saving} onClick={startSphere}>
                      Снять в браузере
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => fileRef.current?.click()}>
                    {saving ? 'Сохраняем…' : 'Загрузить готовую'}
                  </button>
                </div>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('aim')}>
                Сбилось
              </button>
              <button type="button" className={`btn ${savedHere ? 'btn-primary' : 'btn-ghost'}`} disabled={saving} onClick={next}>
                {step + 1 >= route.legs.length ? (savedHere ? 'Готово' : 'Закончить') : savedHere ? 'К следующей точке' : 'Без съёмки — дальше'}
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
        {phase === 'sphere' && (
          <>
            {sphere?.home && (
              <div className={`guide-home ${sphere.moved ? 'is-stop' : ''}`} aria-live="polite">
                <span className="guide-home-arrow" style={{ transform: `rotate(${Math.round(sphere.home.angle)}deg)` }}>
                  <Icon name="chevronUp" size={30} stroke={3} />
                </span>
                <span className="guide-home-text">
                  <strong>Вернитесь на место · {fmtMeters(sphere.home.distance)}</strong>
                  <small>{sideOf(sphere.home.angle)} — к зелёному кольцу на полу</small>
                </span>
              </div>
            )}
            <div className="guide-progress" aria-hidden>
              <span style={{ width: `${spherePct}%` }} />
            </div>
            <p className="guide-step">
              Наводите крестик на фиолетовые точки вокруг — кадр снимается сам, когда телефон замрёт. Кадров: {sphere?.frames ?? 0}.
            </p>
            <div className="row">
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={cancelSphere}>
                Отмена
              </button>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => ar.current?.restartSphere()}>
                Заново
              </button>
              <button
                type="button"
                className={`btn ${(sphere?.fraction ?? 0) >= SPHERE_DONE ? 'btn-success' : 'btn-primary'}`}
                disabled={saving || (sphere?.fraction ?? 0) < SPHERE_MIN}
                onClick={() => void finishSphere()}
              >
                {saving ? 'Сохраняем…' : 'Готово'}
              </button>
            </div>
            {(sphere?.fraction ?? 0) >= SPHERE_MIN && (sphere?.fraction ?? 0) < SPHERE_DONE && <p className="hint">Можно сохранить и так, но неснятые места будут тёмными.</p>}
          </>
        )}
        {phase === 'external' && (
          <>
            <h2>
              Точка {targetNo}: снимите фотосферу в {APP_NAME}
            </h2>
            {savedHere ? (
              <p>
                ✓ Панорама встала в точку {targetNo}. Направление задайте потом: «К плану» → точка с галочкой → «Открыть панораму» → «Повернуть по
                двери».
              </p>
            ) : (
              <ol className="guide-steps">
                <li>В приложении наводите прицел на точки — кадры снимаются сами. Дождитесь склейки и сохраните сферу.</li>
                <li>Вернитесь сюда и нажмите «Загрузить снятую» — выберите последнюю фотографию.</li>
              </ol>
            )}
            {!savedHere && (
              <button type="button" className="btn btn-success btn-block" disabled={saving} onClick={() => fileRef.current?.click()}>
                {saving ? 'Сохраняем…' : 'Загрузить снятую'}
              </button>
            )}
            <div className="row">
              <a className="btn btn-secondary" href={appIntentUrl()}>
                Открыть приложение
              </a>
              <button type="button" className={`btn ${savedHere ? 'btn-primary' : 'btn-ghost'}`} disabled={saving} onClick={() => void continueRoute()}>
                {step + 1 >= route.legs.length ? 'Закончить' : savedHere ? 'Продолжить маршрут' : 'Без съёмки — дальше'}
              </button>
            </div>
            <p className="hint">
              Приложения нет — «Открыть приложение» скачает его (APK, 44 МБ), разрешите установку из браузера.{' '}
              <a href={APP_REPO} target="_blank" rel="noreferrer">
                О приложении
              </a>
            </p>
          </>
        )}
        {phase === 'done' && (
          <>
            <h2>Маршрут пройден</h2>
            <p>Все точки обойдены. Снятые фотосферы уже стоят в своих точках на плане.</p>
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

/** Что делать, если AR не запустился, — по имени ошибки браузера. */
function arFailureText(code: string): string {
  switch (code) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Браузер не дал камеру для AR. Разрешите камеру сайту (значок слева от адреса → Разрешения) и откройте ссылку в самом Chrome, а не во встроенном браузере приложения.';
    case 'NotSupportedError':
    case 'no_xr':
      return 'Этот браузер не запускает AR. Откройте ссылку в самом Chrome (не из Telegram или VK) и проверьте, что установлены «Сервисы Google Play для AR» из Play Маркета.';
    case 'no_overlay':
      return 'AR запустился, но без кнопок поверх камеры. Откройте ссылку в самом Chrome.';
    default:
      return 'AR не запустился. Откройте ссылку в самом Chrome или продолжите по шагам.';
  }
}

/** Встроенный браузер приложения (WebView Telegram, VK, Instagram…) — по строке браузера, не всегда точно. */
function inAppBrowser(): boolean {
  return /; wv\)|Telegram|Instagram|FBA[NV]|VKClient/i.test(navigator.userAgent);
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

/** Где место съёмки относительно взгляда — словами. */
function sideOf(angle: number): string {
  const a = Math.abs(angle);
  if (a <= 30) return 'впереди';
  if (a >= 150) return 'позади';
  return angle > 0 ? 'справа' : 'слева';
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
