#!/usr/bin/env bash
# Arrête la stack locale. --reset supprime aussi la base (migrations rejouées au prochain up.sh).
STATE=${E2E_STACK_DIR:-/tmp/konekt-e2e-stack}
for p in functions vendor-mock gateway auth; do
  [ -f "$STATE/$p.pid" ] && kill "$(cat "$STATE/$p.pid")" 2>/dev/null; rm -f "$STATE/$p.pid"
done
docker rm -f konekt-e2e-rest >/dev/null 2>&1
if [ "${1:-}" = "--reset" ]; then docker rm -f konekt-e2e-db >/dev/null 2>&1; else docker stop konekt-e2e-db >/dev/null 2>&1; fi
echo "Stack arrêtée."
