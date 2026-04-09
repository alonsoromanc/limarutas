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

git -C "$ROOT" ls-files | sed "s|^|$ROOT/|" > "$OUTPUT_DIR/filetree_git.txt"

echo "filetree_git.txt generado en: $OUTPUT_DIR"