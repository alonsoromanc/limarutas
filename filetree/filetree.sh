#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# -r : manda el output a la raíz del repo
# por defecto va a la carpeta del script
OUTPUT_DIR="$SCRIPT_DIR"

while getopts "r" opt; do
  case $opt in
    r) OUTPUT_DIR="$ROOT" ;;
    *) echo "Uso: $0 [-r]"; exit 1 ;;
  esac
done

find "$ROOT" -not -path "$ROOT/.git/*" > "$OUTPUT_DIR/filetree.txt"
echo "filetree.txt generado en: $OUTPUT_DIR"