#!/usr/bin/env bash
# Выложить собранный APK так, чтобы приложения на телефонах предложили обновиться при следующем заходе.
#
#   1. поднять versionCode (и versionName) в apps/android/app/build.gradle.kts;
#   2. cd apps/android && ./gradlew :app:assembleDebug
#   3. tools/publish-android.sh "Что нового" "Ещё пункт"
#
# Кладёт рядом space-map-<versionCode>.apk, space-map.apk (кнопка «Скачать» на сайте) и описание
# space-map.json (его читает AppUpdater). Описание — последним: телефоны не увидят версию, пока файл не на месте.
#
# Переменные:
#   STAND=local       — локальный Vite: файлы в apps/web/public/downloads (по умолчанию стенд команды по SSH);
#   SITE=https://…    — адрес стенда, под который собран APK (по умолчанию стенд команды);
#   JUMP=             — SSH напрямую, без промежуточного сервера (по умолчанию через него: с Mac под VPN стенд иначе не виден);
#   MIN_VERSION=N     — сборки ниже N обязаны обновиться (кнопки «Позже» не будет);
#   FORCE=1           — выложить, даже если versionCode не больше уже выложенного.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/apps/android"
APK="$ANDROID/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk"
KEYSTORE="$ANDROID/keystore/team-debug.keystore"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
STAND="${STAND:-root@193.233.88.64}"
JUMP="${JUMP-root@31.76.28.248}"
DEST="${DEST:-/opt/space-map/public/downloads}"
SITE="${SITE:-https://193-233-88-64.sslip.io}"
MIN_VERSION="${MIN_VERSION:-0}"

die() { echo "Ошибка: $*" >&2; exit 1; }

# Без head/grep -q/awk exit в конвейерах: они закрывают канал раньше времени, и при pipefail скрипт молча падает.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[[ -f "$APK" ]] || die "нет $APK — сначала ./gradlew :app:assembleDebug"
TOOLS="$SDK/build-tools/$(ls -1 "$SDK/build-tools" | tail -1)"
[[ -x "$TOOLS/aapt2" ]] || die "не найден Android SDK (ANDROID_HOME=$SDK)"

# Версия — из самого APK, а не из build.gradle.kts: вдруг собрали не то.
"$TOOLS/aapt2" dump badging "$APK" > "$TMP/badging"
BADGING="$(sed -n 1p "$TMP/badging")"
CODE="$(sed -E "s/.*versionCode='([0-9]+)'.*/\1/" <<<"$BADGING")"
NAME="$(sed -E "s/.*versionName='([^']+)'.*/\1/" <<<"$BADGING")"
[[ "$BADGING" == *"name='ru.spacemap.android'"* ]] || die "это не наше приложение: $BADGING"

# Подписан ключом команды — иначе Android не поставит его поверх установленного.
want="$(keytool -list -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey | awk '/SHA256:/ {print $2}' | tr -d : | tr 'A-F' 'a-f')"
got="$("$TOOLS/apksigner" verify --print-certs "$APK" | awk -F': ' '/certificate SHA-256 digest/ && !n++ {print $2}')"
[[ -n "$want" && "$want" == "$got" ]] || die "APK подписан не ключом команды ($got) — пересоберите из репозитория"

# Собран под этот стенд: иначе телефоны уйдут на чужой адрес и перестанут видеть обновления.
if [[ "$STAND" != local ]]; then
  unzip -p "$APK" 'classes*.dex' > "$TMP/dex"
  LC_ALL=C grep -aqF "$SITE/downloads/space-map.json" "$TMP/dex" \
    || die "APK собран не под $SITE — соберите без -PstartUrl или задайте SITE"
fi

if [[ "$STAND" == local ]]; then
  DEST="$ROOT/apps/web/public/downloads"
  run() { (cd "$DEST" && bash -c "$1"); }
  current="$(cat "$DEST/space-map.json" 2>/dev/null || true)"
else
  run() { ssh ${JUMP:+-J "$JUMP"} "$STAND" "cd '$DEST' && $1"; }
  current="$(run 'cat space-map.json 2>/dev/null || true')"
fi

published="$(node -e 'try { console.log(JSON.parse(process.argv[1]).versionCode) } catch { console.log(0) }' "$current")"
if (( CODE <= published )) && [[ "${FORCE:-}" != 1 ]]; then
  die "versionCode $CODE не больше выложенного ($published) — телефоны не увидят обновления. Поднимите versionCode или FORCE=1"
fi

MANIFEST="$(node - "$CODE" "$NAME" "$APK" "$MIN_VERSION" "$@" <<'JS'
const [code, name, apk, min, ...notes] = process.argv.slice(2);
const fs = require('fs');
const crypto = require('crypto');
const data = fs.readFileSync(apk);
console.log(JSON.stringify({
  versionCode: Number(code),
  versionName: name,
  apk: `space-map-${code}.apk`,
  size: data.length,
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
  notes,
  minVersionCode: Number(min),
  publishedAt: new Date().toISOString(),
}, null, 2));
JS
)"

echo "Выкладываю $NAME (versionCode $CODE) → ${STAND/#local/apps/web/public/downloads}"
if [[ "$STAND" == local ]]; then
  mkdir -p "$DEST"
  cp "$APK" "$DEST/.space-map-$CODE.apk.tmp"
  printf '%s\n' "$MANIFEST" > "$DEST/.space-map.json.tmp"
else
  scp -q ${JUMP:+-J "$JUMP"} "$APK" "$STAND:$DEST/.space-map-$CODE.apk.tmp"
  printf '%s\n' "$MANIFEST" | run 'cat > .space-map.json.tmp'
fi
# Переименование атомарно: Caddy никогда не отдаст недописанный файл. Хранятся две последние сборки.
run "chmod 644 .space-map-$CODE.apk.tmp .space-map.json.tmp \
  && mv -f .space-map-$CODE.apk.tmp space-map-$CODE.apk \
  && cp space-map-$CODE.apk .space-map.apk.tmp && mv -f .space-map.apk.tmp space-map.apk \
  && mv -f .space-map.json.tmp space-map.json \
  && ls -1t space-map-*.apk | tail -n +3 | xargs rm -f --"

echo "$MANIFEST"
echo "Готово: при следующем заходе приложение предложит обновиться до $NAME."
