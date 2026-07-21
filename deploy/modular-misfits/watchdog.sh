#!/bin/zsh

set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

deploy_dir="${0:A:h}"
compose_file="${deploy_dir}/compose.yml"
env_file="${deploy_dir}/.env"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

if [[ ! -f "${env_file}" ]]; then
  log "OpenSign watchdog cannot find ${env_file}"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  log "Docker is unavailable; starting Docker Desktop"
  /usr/bin/open -gj -a Docker

  for _ in {1..36}; do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 5
  done
fi

if ! docker info >/dev/null 2>&1; then
  log "Docker did not become ready"
  exit 1
fi

if /usr/bin/curl -fsS --max-time 5 http://127.0.0.1:3100/api/healthz >/dev/null; then
  exit 0
fi

if ! docker compose --env-file "${env_file}" -f "${compose_file}" up -d >/dev/null 2>&1; then
  log "OpenSign compose reconciliation failed"
  exit 1
fi

for _ in {1..24}; do
  if /usr/bin/curl -fsS --max-time 5 http://127.0.0.1:3100/api/healthz >/dev/null; then
    exit 0
  fi
  sleep 5
done

log "OpenSign did not become healthy after compose reconciliation"
exit 1
