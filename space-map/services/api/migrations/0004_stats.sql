-- Статистика просмотров для организатора: счётчики по дням. Без cookies и без данных о посетителях — только сколько раз.
-- open — открыли карту (раз за сеанс вкладки), place — карточку места, route — маршрут (target — место назначения),
-- panorama — панораму, search_miss — поиск без результатов (target — что искали).
CREATE TABLE venue_stats (
  venue_id uuid    NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day      date    NOT NULL,
  kind     text    NOT NULL CHECK (kind IN ('open', 'place', 'route', 'panorama', 'search_miss')),
  target   text    NOT NULL DEFAULT '',
  count    integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (venue_id, day, kind, target)
);
