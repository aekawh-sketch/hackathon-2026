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
}

export interface PanoramaViewerProps {
  imageUrl: string;
  previewUrl?: string;
  markers: PanoMarker[];
  /** Куда смотреть после загрузки, градусы. */
  initialYaw?: number;
  onMarkerClick?: (marker: PanoMarker) => void;
  onError?: () => void;
}

export default function PanoramaViewer({ imageUrl, previewUrl, markers, initialYaw = 0, onMarkerClick, onError }: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const callbacks = useRef({ onMarkerClick, onError });
  callbacks.current = { onMarkerClick, onError };
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
    plugin.setMarkers(
      markers.map((m) => ({
        id: m.id,
        position: { yaw: `${m.yaw}deg`, pitch: `${m.pitch}deg` },
        element: markerElement(m),
        anchor: m.kind === 'link' ? 'center center' : 'bottom center',
        // У мест подпись уже под значком, подсказка нужна только стрелкам переходов.
        ...(m.kind === 'link' ? { tooltip: { content: escapeHtml(m.label), position: 'top center' } } : {}),
      })),
    );
  }, [markers]);

  return <div ref={containerRef} className="pano-viewer" />;
}

// Текст мест приходит от организатора: собираем DOM, а не HTML-строку.
function markerElement(m: PanoMarker): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = m.kind === 'link' ? 'pano-link' : 'pano-place';
  el.setAttribute('aria-label', m.label);
  if (m.kind === 'place' && m.color) el.style.setProperty('--marker', m.color);
  el.appendChild(svgIcon(m.kind === 'link' ? ICON_PATHS.chevronUp : categoryIconPath(m.icon ?? '')));
  if (m.kind === 'place') {
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
