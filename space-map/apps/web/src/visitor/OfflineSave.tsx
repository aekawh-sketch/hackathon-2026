// «Сохранить для офлайна»: карта, её панорамы и части сайта для 3D и панорам — в кэш устройства.
// Дальше карта открывается по той же ссылке без интернета (кэш читает service worker, public/sw.js).
import type { MapDocument } from '@space-map/map-core';
import { useEffect, useState } from 'react';
import { panoramaUrls } from '../api.ts';
import { Icon } from '../ui/icons.tsx';

/** Тот же кэш, что у service worker для данных карт. */
const DATA_CACHE = 'space-map-data-v1';

type State = { kind: 'idle' | 'saved' | 'stale' | 'error' } | { kind: 'saving'; done: number; total: number };

export function OfflineSave({ slug, doc, version }: { slug: string; doc: MapDocument; version: number | null }) {
  const key = `space-map:offline:${slug}`;
  const stamp = String(version ?? 'demo');
  const [state, setState] = useState<State>(() => {
    const saved = readKey(key);
    return { kind: saved === null ? 'idle' : saved === stamp ? 'saved' : 'stale' };
  });
  if (typeof caches === 'undefined' || !('serviceWorker' in navigator)) return null;

  const save = async () => {
    const urls = [
      ...(version !== null ? [`/p/${slug}/latest.json`, `/p/${slug}/v/${version}/map.json`] : []),
      ...doc.panoramas.flatMap((p) => [panoramaUrls(p).preview, panoramaUrls(p).image]),
    ];
    setState({ kind: 'saving', done: 0, total: urls.length });
    try {
      // Части сайта, которые грузятся по требованию: 3D и просмотр панорам. Их кладёт в кэш service worker.
      await Promise.all([import('../three/Model3DView.tsx'), import('../panorama/PanoramaViewer.tsx')]);
      const cache = await caches.open(DATA_CACHE);
      let done = 0;
      for (const url of urls) {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        await cache.put(url, res);
        setState({ kind: 'saving', done: ++done, total: urls.length });
      }
      try {
        localStorage.setItem(key, stamp);
      } catch {
        // Не запомнили отметку — кэш всё равно есть.
      }
      setState({ kind: 'saved' });
    } catch {
      setState({ kind: 'error' });
    }
  };

  if (state.kind === 'saved') {
    return (
      <p className="offline-note">
        <Icon name="check" size={16} /> Карта сохранена — откроется по этой ссылке и без интернета
      </p>
    );
  }
  return (
    <button type="button" className="btn btn-secondary offline-btn" disabled={state.kind === 'saving'} onClick={() => void save()}>
      <Icon name="offline" size={18} />
      {state.kind === 'saving'
        ? `Сохраняем… ${state.done} из ${state.total}`
        : state.kind === 'stale'
          ? 'Карту обновили — сохранить новую версию'
          : state.kind === 'error'
            ? 'Не получилось — попробовать ещё раз'
            : `Сохранить для офлайна${doc.panoramas.length ? ` · ${doc.panoramas.length} панорам` : ''}`}
    </button>
  );
}

/** Есть ли сеть — для пометки «Без интернета». */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
