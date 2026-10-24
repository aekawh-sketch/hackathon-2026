// Просмотр фотосферы (ТЗ 5.7, 5.12, 7.1). Один экземпляр Viewer на всё время жизни компонента:
// смена панорамы — setPanorama, а не новый Viewer; при закрытии destroy() освобождает WebGL.
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { useEffect, useRef } from 'react';
import { categoryIconPath, ICON_PATHS } from '../ui/icons.tsx';

export interface PanoMarker {
  id: string;
  kind: 'place' | 'link';
  yaw: number;
  pitch: number;
  label: string;
  /** Иконка категории (имя из набора иконок). */
  icon?: string;
  color?: string;
  /**
   * Стрелка перехода относительно маршрута: next — дальше по маршруту (крупная, с подписью),
   * prev — назад по маршруту, off — в сторону от маршрута (приглушена). Нет — маршрута нет.
   */
  route?: 'next' | 'prev' | 'off';
}

export interface PanoramaViewerProps {
  imageUrl: string;
  previewUrl?: string;
  markers: PanoMarker[];
  /** Линия маршрута на полу: куски из точек [yaw, pitch] в градусах. */
  routeLines?: [number, number][][];
  /** Куда смотреть после загрузки, градусы. */
  initialYaw?: number;
  onMarkerClick?: (marker: PanoMarker) => void;
  /** Нажали на саму панораму (не на метку): yaw и pitch в градусах — для «повернуть по двери». */
  onPanoClick?: (yaw: number, pitch: number) => void;
  onError?: () => void;
}

export default function PanoramaViewer({ imageUrl, previewUrl, markers, routeLines = [], initialYaw = 0, onMarkerClick, onPanoClick, onError }: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const callbacks = useRef({ onMarkerClick, onPanoClick, onError });
  callbacks.current = { onMarkerClick, onPanoClick, onError };
  const markersRef = useRef(markers);
  markersRef.current = markers;

  useEffect(() => {
    const viewer = new Viewer({
      container: containerRef.current!,
      panorama: previewUrl ?? imageUrl,
      defaultYaw: `${initialYaw}deg`,
      navbar: ['zoom', 'fullscreen'],
      defaultZoomLvl: 30,
      touchmoveTwoFingers: false,
      mousewheelCtrlKey: false,
      loadingTxt: 'Загрузка…',
      lang: { zoom: 'Масштаб', zoomIn: 'Приблизить', zoomOut: 'Отдалить', fullscreen: 'На весь экран', loadError: 'Панорама не загрузилась' },
      plugins: [MarkersPlugin],
    });
    viewerRef.current = viewer;
    const markersPlugin = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    markersPlugin.addEventListener('select-marker', ({ marker }) => {
      const found = markersRef.current.find((m) => m.id === marker.id);
      if (found) callbacks.current.onMarkerClick?.(found);
    });
    viewer.addEventListener('panorama-error', () => callbacks.current.onError?.());
    viewer.addEventListener('click', ({ data }) => {
      if (data.rightclick) return;
      const deg = (r: number) => (r * 180) / Math.PI;
      // yaw у просмотрщика 0…360 — приводим к −180…180, как в документе карты.
      const yaw = ((deg(data.yaw) + 540) % 360) - 180;
      callbacks.current.onPanoClick?.(Math.round(yaw * 10) / 10, Math.round(deg(data.pitch) * 10) / 10);
    });
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
    // Viewer создаётся один раз; дальше меняем панораму и метки.
  }, []);

  // Смена панорамы: сначала лёгкое превью, затем полная картинка (ТЗ 7.1).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    const position = { yaw: `${initialYaw}deg`, pitch: 0 };
    const showFull = () => {
      if (cancelled || !previewUrl) return;
      void viewer.setPanorama(imageUrl, { transition: false, showLoader: false, position });
    };
    void viewer
      .setPanorama(previewUrl ?? imageUrl, { transition: { speed: 600, rotation: false }, position })
      .then(showFull)
      .catch(() => callbacks.current.onError?.());
    return () => {
      cancelled = true;
    };
  }, [imageUrl, previewUrl, initialYaw]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const plugin = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    const rad = (deg: number) => (deg * Math.PI) / 180;
    // Линия маршрута лежит на полу: белая подложка и синяя линия поверх — видна и на светлом полу.
    const route = routeLines.flatMap((line, i) => {
      const polyline = line.map(([yaw, pitch]) => [rad(yaw), rad(pitch)] as [number, number]);
      return [
        { id: `route-casing:${i}`, polyline, svgStyle: { stroke: 'rgba(255,255,255,0.85)', strokeWidth: '14px', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } },
        { id: `route:${i}`, polyline, svgStyle: { stroke: '#2F5BEA', strokeWidth: '8px', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } },
      ];
    });
    plugin.setMarkers([
      ...route,
      ...markers.map((m) => ({
        id: m.id,
        position: { yaw: `${m.yaw}deg`, pitch: `${m.pitch}deg` },
        element: markerElement(m),
        anchor: m.kind === 'link' ? 'center center' : 'bottom center',
        // У мест и у стрелки «Дальше» подпись уже под значком, подсказка нужна остальным стрелкам.
        ...(m.kind === 'link' && m.route !== 'next' ? { tooltip: { content: escapeHtml(m.label), position: 'top center' } } : {}),
      })),
    ]);
  }, [markers, routeLines]);

  return <div ref={containerRef} className="pano-viewer" />;
}

// Текст мест приходит от организатора: собираем DOM, а не HTML-строку.
function markerElement(m: PanoMarker): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = m.kind === 'link' ? `pano-link${m.route ? ` is-${m.route}` : ''}` : 'pano-place';
  el.setAttribute('aria-label', m.label);
  if (m.kind === 'place' && m.color) el.style.setProperty('--marker', m.color);
  el.appendChild(svgIcon(m.kind === 'link' ? ICON_PATHS.chevronUp : categoryIconPath(m.icon ?? '')));
  // Цвет — не единственный признак (ТЗ 5.12): у стрелки «Дальше» ещё размер и подпись.
  if (m.kind === 'place' || m.route === 'next') {
    const label = document.createElement('span');
    label.className = 'pano-place-label';
    label.textContent = m.label;
    el.appendChild(label);
  }
  return el;
}

function svgIcon(d: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
