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

echo "→ Пакеты"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

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
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP"
fi
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

# Ежедневная копия базы, хранится 14 дней. Файлы анализов уже зашифрованы и копируются как есть.
cat > /usr/local/bin/nutri-backup <<'BK'
#!/usr/bin/env bash
set -e
D=$(date +%F)
cd /var/backups/nutri
node -e "require('node:sqlite').backup(new (require('node:sqlite').DatabaseSync)('/var/lib/nutri/nutri.db'), '/var/backups/nutri/nutri-$D.db').then(()=>{})" 2>/dev/null
tar -czf "files-$D.tgz" -C /var/lib/nutri files
find /var/backups/nutri -type f -mtime +14 -delete
BK
chmod 755 /usr/local/bin/nutri-backup
echo "30 3 * * * nutri /usr/local/bin/nutri-backup" > /etc/cron.d/nutri-backup

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
systemctl restart nutri caddy
sleep 2
systemctl is-active -q nutri && echo "✓ Сервис запущен"

echo
echo "Готово: https://$DOMAIN"
echo "Первый зарегистрированный аккаунт — специалист, дальше только по приглашениям."
if [ "${NEWKEY:-}" = 1 ]; then
  echo
  echo "Сохраните ключ шифрования в надёжном месте (без него файлы анализов не расшифровать):"
  grep NUTRI_FILE_KEY "$ENVFILE"
fi
