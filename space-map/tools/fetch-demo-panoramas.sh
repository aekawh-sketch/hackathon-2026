#!/usr/bin/env bash
# Демо-панорамы для просмотрщика (ТЗ 11.3). Источник — Poly Haven, лицензия CC0.
# Это готовые примеры: они проверяют просмотрщик, а не нашу съёмку и склейку.
# Требует macOS (sips) — в контейнере воркера то же делает pyvips.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/tools/.cache/polyhaven"
OUT="$ROOT/apps/web/public/demo/panoramas"
mkdir -p "$CACHE" "$OUT"

# id в демо-карте → ассет Poly Haven
PAIRS=(
  "demo-lobby:newman_lobby"
  "demo-corridor:newman_cafeteria"
  "demo-hall:events_hall_interior"
)

credits="$OUT/CREDITS.md"
{
  echo "# Демо-панорамы"
  echo
  echo "Готовые примеры с [Poly Haven](https://polyhaven.com), лицензия [CC0](https://polyhaven.com/license)."
  echo "Не наша съёмка: проверяют просмотрщик, а не модуль съёмки и склейку."
  echo
  echo "| Файл | Ассет | Автор |"
  echo "|---|---|---|"
} > "$credits"

for pair in "${PAIRS[@]}"; do
  id="${pair%%:*}"
  asset="${pair##*:}"
  meta="$(curl -fsS -A "space-map-hackathon" "https://api.polyhaven.com/files/$asset")"
  url="$(python3 -I -c 'import json,sys; print(json.load(sys.stdin)["tonemapped"]["url"])' <<<"$meta")"
  md5="$(python3 -I -c 'import json,sys; print(json.load(sys.stdin)["tonemapped"]["md5"])' <<<"$meta")"
  src="$CACHE/$asset.jpg"

  if [[ ! -f "$src" ]] || [[ "$(md5 -q "$src")" != "$md5" ]]; then
    echo "скачиваю ${asset}…"
    curl -fsSL -A "space-map-hackathon" -o "$src" "$url"
    [[ "$(md5 -q "$src")" == "$md5" ]] || { echo "md5 не совпал для $asset" >&2; exit 1; }
  fi

  sips -s format jpeg -s formatOptions 82 -z 2048 4096 "$src" --out "$OUT/$id.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 70 -z 512 1024 "$src" --out "$OUT/$id-preview.jpg" >/dev/null

  author="$(curl -fsS -A "space-map-hackathon" "https://api.polyhaven.com/info/$asset" \
    | python3 -I -c 'import json,sys; print(", ".join(json.load(sys.stdin)["authors"]))')"
  echo "| \`$id.jpg\` | [$asset](https://polyhaven.com/a/$asset) | $author |" >> "$credits"
  echo "готово: $id"
done
