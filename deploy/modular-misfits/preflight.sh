#!/bin/sh

set -eu

deploy_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
env_file=${1:-"${deploy_dir}/.env"}

fail() {
  printf 'OpenSign preflight failed: %s\n' "$*" >&2
  exit 1
}

env_value() {
  key=$1
  awk -v key="$key" '
    index($0, key "=") == 1 {
      sub(/^[^=]*=/, "")
      sub(/\r$/, "")
      print
      exit
    }
  ' "$env_file"
}

[ -r "$env_file" ] || fail "cannot read ${env_file}"

template_dir=${PORTAL_NDA_TEMPLATE_DIR:-$(env_value PORTAL_NDA_TEMPLATE_DIR)}
config_dir=${PORTAL_NDA_CONFIG_DIR:-$(env_value PORTAL_NDA_CONFIG_DIR)}

[ -n "$template_dir" ] || fail 'PORTAL_NDA_TEMPLATE_DIR is required'
[ -n "$config_dir" ] || fail 'PORTAL_NDA_CONFIG_DIR is required'

layout_file=${config_dir%/}/layout.json
[ -r "$layout_file" ] || fail "cannot read ${layout_file}"

for filename in \
  mm-mutual-nda-template.pdf \
  cycrypt-mutual-nda-template.pdf \
  xpress-mutual-nda-template.pdf
do
  pdf=${template_dir%/}/${filename}
  [ -r "$pdf" ] || fail "cannot read ${pdf}"
  magic=$(LC_ALL=C dd if="$pdf" bs=5 count=1 2>/dev/null || true)
  [ "$magic" = '%PDF-' ] || fail "${pdf} is not a PDF"
  grep -Fq "\"${filename}\"" "$layout_file" ||
    fail "${layout_file} does not reference ${filename}"
done

for company in mm cycrypt xpress
do
  grep -Eq "\"${company}\"[[:space:]]*:" "$layout_file" ||
    fail "${layout_file} does not define ${company}"
done

printf 'Portal NDA asset preflight passed\n'
