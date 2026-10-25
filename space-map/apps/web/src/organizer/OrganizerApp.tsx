// Кабинет организатора (ТЗ 8.1): вход, мои площадки, редактор площадки на сервере.
// /app/editor — демо-редактор без сервера (правки в браузере).
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { RequireUser, SessionProvider } from './session.tsx';

const EditorPage = lazy(() => import('../editor/EditorPage.tsx'));
const ServerEditorPage = lazy(() => import('../editor/EditorPage.tsx').then((m) => ({ default: m.ServerEditorPage })));
const AuthPage = lazy(() => import('./AuthPage.tsx'));
const VenuesPage = lazy(() => import('./VenuesPage.tsx'));
const StatsPage = lazy(() => import('./StatsPage.tsx'));

export default function OrganizerApp() {
  return (
    <SessionProvider>
      <Suspense
        fallback={
          <div className="screen-message">
            <div className="loader" aria-label="Загрузка" />
          </div>
        }
      >
        <Routes>
          <Route
            index
            element={
              <RequireUser>
                <VenuesPage />
              </RequireUser>
            }
          />
          <Route path="login" element={<AuthPage />} />
          <Route
            path="venues/:id"
            element={
              <RequireUser>
                <ServerEditorPage />
              </RequireUser>
            }
          />
          <Route
            path="venues/:id/stats"
            element={
              <RequireUser>
                <StatsPage />
              </RequireUser>
            }
          />
          <Route path="editor" element={<EditorPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </Suspense>
    </SessionProvider>
  );
}
