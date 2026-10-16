#!/usr/bin/env bash
# Установка и обновление Нутри на чистом Ubuntu 22.04/24.04.
# Запуск:  curl -fsSL https://raw.githubusercontent.com/maryvrbv/nutri/claude/cool-thompson-xajx0d/deploy/install.sh | sudo bash
# Свой домен: ... | sudo DOMAIN=nutri.example.ru bash   (иначе адрес вида 1-2-3-4.sslip.io)
# Повторный запуск обновляет код, данные и ключ не трогает.
set -euo pipefail

BRANCH="${BRANCH:-claude/cool-thompson-xajx0d}"
REPO="https://github.com/maryvrbv/nutri.git"
APP=/opt/nutri
DATA=/var/lib/nutri
ENVFILE=/etc/nutri.env

[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# На маленьких машинах (1 ГБ памяти) сборке нужен файл подкачки
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  echo "→ Файл подкачки 1 ГБ"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# В образах Cloud.ru пакеты берутся с внутреннего зеркала, которое доступно не из всех сетей.
# Если оно не отвечает, переключаемся на зеркало Яндекса с официальными пакетами Ubuntu.
if grep -rqs 'sbercloud' /etc/apt/sources.list /etc/apt/sources.list.d/ && ! getent hosts repo.mng.sbercloud.tech >/dev/null; then
  echo "→ Переключаю репозитории Ubuntu на mirror.yandex.ru"
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] && sed -i -E 's#https?://repo\.mng\.sbercloud\.tech/repository/ubuntu/?#http://mirror.yandex.ru/ubuntu/#g' "$f"
  done
fi

echo "→ Пакеты"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
# Распознавание фото и сканов бланков прямо на сервере
apt-get install -y -qq tesseract-ocr tesseract-ocr-rus poppler-utils imagemagick >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "→ Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  echo "→ Caddy (HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

id nutri >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin nutri
mkdir -p "$DATA" /var/backups/nutri
chown nutri:nutri "$DATA" /var/backups/nutri
chmod 700 "$DATA" /var/backups/nutri

echo "→ Код"
git config --global --add safe.directory "$APP" 2>/dev/null || true
if ! { [ -d "$APP/.git" ] && git -C "$APP" fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"; }; then
  # Нет копии или она сломана — скачиваем код заново рядом и подменяем
  rm -rf "$APP.new"
  git clone -q --branch "$BRANCH" "$REPO" "$APP.new" || { echo "Не удалось скачать код с GitHub"; exit 1; }
  rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"
  mv "$APP.new" "$APP"
fi
echo "  версия $(git -C "$APP" log -1 --format='%h %s')"
cd "$APP"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent >/dev/null

if [ ! -f "$ENVFILE" ]; then
  echo "→ Ключ шифрования файлов"
  KEY=$(head -c 32 /dev/urandom | base64)
  printf 'NODE_ENV=production\nPORT=3000\nNUTRI_DATA_DIR=%s\nNUTRI_FILE_KEY=%s\n' "$DATA" "$KEY" > "$ENVFILE"
  chmod 600 "$ENVFILE"
  NEWKEY=1
fi

cat > /etc/systemd/system/nutri.service <<UNIT
[Unit]
Description=Nutri
After=network.target

[Service]
User=nutri
WorkingDirectory=$APP
EnvironmentFile=$ENVFILE
ExecStart=/usr/bin/node --experimental-strip-types --disable-warning=ExperimentalWarning server/src/index.ts
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# Ежедневная копия базы, хранится 7 дней. Файлы анализов уже зашифрованы и копируются как есть.
cat > /usr/local/bin/nutri-backup <<'BK'
#!/usr/bin/env bash
set -e
D=$(date +%F)
cd /var/backups/nutri
node -e "require('node:sqlite').backup(new (require('node:sqlite').DatabaseSync)('/var/lib/nutri/nutri.db'), '/var/backups/nutri/nutri-$D.db').then(()=>{})" 2>/dev/null
tar -czf "files-$D.tgz" -C /var/lib/nutri files
find /var/backups/nutri -type f -mtime +7 -delete
BK
chmod 755 /usr/local/bin/nutri-backup
echo "30 3 * * * nutri /usr/local/bin/nutri-backup" > /etc/cron.d/nutri-backup

# Обновление вручную одной командой: sudo nutri-update
cat > /usr/local/bin/nutri-update <<UPD
#!/usr/bin/env bash
set -e
git -C $APP fetch -q origin "$BRANCH" && git -C $APP reset -q --hard "origin/$BRANCH"
bash $APP/deploy/install.sh
UPD
chmod 755 /usr/local/bin/nutri-update

# Автообновление: каждые 5 минут проверяем, есть ли новый код. Перед обновлением — копия базы;
# если сборка или запуск не удались, возвращаем прошлую версию.
cat > /usr/local/bin/nutri-autoupdate <<AUTO
#!/usr/bin/env bash
set -uo pipefail
exec 9>/run/nutri-update.lock
flock -n 9 || exit 0
git -C $APP fetch -q origin "$BRANCH" || exit 0
OLD=\$(git -C $APP rev-parse HEAD)
NEW=\$(git -C $APP rev-parse "origin/$BRANCH")
[ "\$OLD" = "\$NEW" ] && exit 0
echo "Обновление \${OLD:0:7} → \${NEW:0:7}"
sudo -u nutri /usr/local/bin/nutri-backup || true
healthy() { for i in \$(seq 1 20); do curl -fsS -o /dev/null http://localhost:3000/api/auth/options && return 0; sleep 1; done; return 1; }
if git -C $APP reset -q --hard "\$NEW" && bash $APP/deploy/install.sh && healthy; then
  echo "Готово"
else
  echo "Не получилось — возвращаю \${OLD:0:7}"
  git -C $APP reset -q --hard "\$OLD"
  cd $APP && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent >/dev/null
  systemctl restart nutri
  exit 1
fi
AUTO
chmod 755 /usr/local/bin/nutri-autoupdate

cat > /etc/systemd/system/nutri-autoupdate.service <<UNIT
[Unit]
Description=Nutri: автообновление
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/nutri-autoupdate
UNIT

cat > /etc/systemd/system/nutri-autoupdate.timer <<UNIT
[Unit]
Description=Nutri: проверка обновлений каждые 5 минут

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT

if [ -z "${DOMAIN:-}" ]; then
  IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
  DOMAIN="$(echo "$IP" | tr . -).sslip.io"
fi
cat > /etc/caddy/Caddyfile <<CF
$DOMAIN {
  encode gzip
  reverse_proxy localhost:3000
}
CF

systemctl daemon-reload
systemctl enable -q --now nutri
systemctl enable -q --now nutri-autoupdate.timer
systemctl restart nutri caddy
sleep 2
systemctl is-active -q nutri && echo "✓ Сервис запущен"

echo
echo "Готово: https://$DOMAIN"
echo "Первый зарегистрированный аккаунт — специалист, дальше только по приглашениям."
echo "Новый код ставится сам каждые 5 минут. Журнал: journalctl -u nutri-autoupdate"
if [ "${NEWKEY:-}" = 1 ]; then
  echo
  echo "Сохраните ключ шифрования в надёжном месте (без него файлы анализов не расшифровать):"
  grep NUTRI_FILE_KEY "$ENVFILE"
fi
