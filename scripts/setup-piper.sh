#!/bin/bash
# Downloads Piper TTS binary + PT-BR and ES-MX neural voice models.
# Run from the project root: bash scripts/setup-piper.sh

set -e

PIPER_DIR="$(cd "$(dirname "$0")/.." && pwd)/data/piper"
MODEL_DIR="$PIPER_DIR/models"

mkdir -p "$MODEL_DIR"

PIPER_VERSION="2023.11.14-2"
PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz"
VOICES_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

echo "=== Piper TTS Setup ==="
echo "Directorio: $PIPER_DIR"
echo ""

# Download piper binary
if [ -f "$PIPER_DIR/piper" ]; then
  echo "[OK] piper binary ya existe"
else
  echo "[1/3] Descargando piper binary..."
  cd "$PIPER_DIR"
  wget -q --show-progress "$PIPER_URL" -O piper.tar.gz
  tar xf piper.tar.gz --strip-components=1
  rm piper.tar.gz
  chmod +x piper
  echo "[OK] piper binary instalado"
fi

# Download PT-BR voice
if [ -f "$MODEL_DIR/pt_BR-faber-medium.onnx" ]; then
  echo "[OK] Voz PT-BR (faber-medium) ya existe"
else
  echo "[2/3] Descargando voz PT-BR (faber-medium, ~65MB)..."
  wget -q --show-progress "$VOICES_BASE/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx" -O "$MODEL_DIR/pt_BR-faber-medium.onnx"
  wget -q "$VOICES_BASE/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json" -O "$MODEL_DIR/pt_BR-faber-medium.onnx.json"
  echo "[OK] Voz PT-BR instalada"
fi

# Download ES-MX voice
if [ -f "$MODEL_DIR/es_MX-ald-medium.onnx" ]; then
  echo "[OK] Voz ES-MX (ald-medium) ya existe"
else
  echo "[3/3] Descargando voz ES-MX (ald-medium, ~65MB)..."
  wget -q --show-progress "$VOICES_BASE/es/es_MX/ald/medium/es_MX-ald-medium.onnx" -O "$MODEL_DIR/es_MX-ald-medium.onnx"
  wget -q "$VOICES_BASE/es/es_MX/ald/medium/es_MX-ald-medium.onnx.json" -O "$MODEL_DIR/es_MX-ald-medium.onnx.json"
  echo "[OK] Voz ES-MX instalada"
fi

echo ""
echo "=== Listo! ==="
echo "Piper TTS configurado en: $PIPER_DIR"
echo "Reiniciá el servicio: sudo systemctl restart senhaentrada"

# Quick test
echo ""
echo "Test rápido..."
echo "Senha um dois três" | "$PIPER_DIR/piper" --model "$MODEL_DIR/pt_BR-faber-medium.onnx" --output_file /tmp/piper-test.wav 2>/dev/null
if [ -f /tmp/piper-test.wav ]; then
  echo "[OK] Piper genera audio correctamente!"
  rm /tmp/piper-test.wav
else
  echo "[ERROR] Piper no generó audio. Verificar instalación."
fi
