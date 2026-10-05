#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

echo "==> node_modules"
if [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund >/dev/null || exit 1
else
  echo "    ok"
fi

echo "==> chromium"
if ! ls /tmp/kilo-worktrees/*/.cache/ms-playwright/chromium_headless_shell-*/ >/dev/null 2>&1 &&
   ! ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium_headless_shell-* >/dev/null 2>&1; then
  npx playwright install chromium >/dev/null 2>&1 || exit 1
else
  echo "    ok"
fi

echo "==> libs do sistema"
if ! ldconfig -p 2>/dev/null | grep -q libnspr4; then
  npx playwright install-deps chromium >/dev/null 2>&1 || echo "    aviso: nao foi possivel instalar deps"
else
  echo "    ok"
fi

echo "==> testes"
exec npx playwright test "$@"
