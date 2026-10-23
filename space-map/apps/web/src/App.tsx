import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { VisitorPage } from './visitor/VisitorPage.tsx';

// Кабинет организатора — отдельный чанк: посетитель его код не скачивает (ТЗ п. 44).
const OrganizerApp = lazy(() => import('./organizer/OrganizerApp.tsx'));

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/m/demo" replace />} />
        <Route path="/m/:slug" element={<VisitorPage />} />
        <Route
          path="/app/*"
          element={
            <Suspense fallback={<div className="screen-message"><div className="loader" aria-label="Загрузка кабинета" /></div>}>
              <OrganizerApp />
            </Suspense>
          }
        />
        <Route path="*" element={<div className="screen-message">Страница не найдена</div>} />
      </Routes>
    </BrowserRouter>
  );
}
