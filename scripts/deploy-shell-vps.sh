#!/usr/bin/env bash
# Builds web/dist-shell and swaps it into /var/www/cw on the project's own VPS (cw.y0p66y9.me), atomically.
# Needs the SSH key ~/.ssh/cw_oracle (password login is off). Server setup: docs/notes/remote-anywhere.md「自己的服务器」.
set -euo pipefail
HOST="${CW_VPS:-root@198.44.111.28}"
KEY="${CW_VPS_KEY:-$HOME/.ssh/cw_oracle}"
cd "$(dirname "$0")/.."
env -u ELECTRON_RUN_AS_NODE npm run build:shell -w web
tmp="$(mktemp)"
tar czf "$tmp" -C web/dist-shell .
scp -i "$KEY" -q "$tmp" "$HOST:/tmp/shell.tgz"
rm -f "$tmp"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'set -e
rm -rf /var/www/cw.new && mkdir -p /var/www/cw.new && tar xzf /tmp/shell.tgz -C /var/www/cw.new
rm -rf /var/www/cw.old; [ -d /var/www/cw ] && mv /var/www/cw /var/www/cw.old; mv /var/www/cw.new /var/www/cw
rm -f /tmp/shell.tgz'
curl -sS -o /dev/null -w "https://cw.y0p66y9.me/ -> %{http_code}\n" https://cw.y0p66y9.me/
