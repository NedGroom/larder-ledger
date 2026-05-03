Tesseract (local OCR) notes

To enable local receipt parsing with Tesseract (used by the receipts endpoint), install the Tesseract binary.

macOS (Homebrew):

```bash
brew install tesseract
```

Ubuntu/Debian:

```bash
sudo apt update && sudo apt install -y tesseract-ocr
```

The Python code uses `pytesseract` and `Pillow`. If Tesseract binary is not available, the receipts endpoint will still accept and store uploads but will not return parsed text.

Consider adding a worker container with Tesseract installed if you want server-side OCR in production.

