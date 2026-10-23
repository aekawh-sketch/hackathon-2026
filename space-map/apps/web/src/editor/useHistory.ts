// История правок для «Отменить / Повторить». Документы неизменяемые, поэтому храним их целиком.
import { useCallback, useState } from 'react';

const LIMIT = 100;

interface State<T> {
  past: T[];
  present: T;
  future: T[];
}

export function useHistory<T>(initial: () => T) {
  const [state, setState] = useState<State<T>>(() => ({ past: [], present: initial(), future: [] }));

  const commit = useCallback((next: T) => {
    setState((s) => (next === s.present ? s : { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [] }));
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      const prev = s.past[s.past.length - 1];
      if (prev === undefined) return s;
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      const [next, ...rest] = s.future;
      if (next === undefined) return s;
      return { past: [...s.past, s.present], present: next, future: rest };
    });
  }, []);

  /** Новое начало без истории (сброс демо, загрузка файла). */
  const reset = useCallback((doc: T) => setState({ past: [], present: doc, future: [] }), []);

  return { doc: state.present, commit, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
