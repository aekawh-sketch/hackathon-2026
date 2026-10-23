// Кабинет организатора. Пока без сервера: редактор демо-площадки (план, помещения, места, двери).
// Следующий этап — вход, список площадок и публикация (ТЗ 8.1).
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

const EditorPage = lazy(() => import('../editor/EditorPage.tsx'));

export default function OrganizerApp() {
  return (
    <Suspense
      fallback={
        <div className="screen-message">
          <div className="loader" aria-label="Загрузка редактора" />
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="editor" replace />} />
        <Route path="editor" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="editor" replace />} />
      </Routes>
    </Suspense>
  );
}
