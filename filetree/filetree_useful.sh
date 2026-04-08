#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUTPUT_DIR="$SCRIPT_DIR"

while getopts "r" opt; do
  case $opt in
    r) OUTPUT_DIR="$ROOT" ;;
    *) echo "Uso: $0 [-r]"; exit 1 ;;
  esac
done

find "$ROOT" \
  -not -path "$ROOT/.git/*" \
  -not -path "$ROOT/data/processed/transporte/*" \
  -not -path "$ROOT/sandbox/*" \
  -not -path "$ROOT/_legacy/*" \
  -not -path "$ROOT/pipeline/temp/*" \
  -not -path "$ROOT/pipeline/scripts/wikiroutes/data/*" \
  -not -path "$ROOT/pipeline/scripts/wikiroutes/data_wikiroutes/*" \
  -not -path "$ROOT/pipeline/scripts/wikiroutes/__pycache__/*" \
  -not -path "$ROOT/assets/icons/*" \
  > "$OUTPUT_DIR/filetree_useful.txt"

echo "filetree_useful.txt generado en: $OUTPUT_DIR"