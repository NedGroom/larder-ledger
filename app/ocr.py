import os
from typing import Optional

# optional import of pytesseract / PIL; gracefully degrade if not installed
try:
    from PIL import Image
    import pytesseract
    TESSERACT_AVAILABLE = True
except Exception:
    TESSERACT_AVAILABLE = False


def parse_image_for_text(path: str) -> Optional[str]:
    """Return extracted text from image at path if tesseract is available, else None."""
    if not TESSERACT_AVAILABLE:
        return None
    try:
        img = Image.open(path)
        text = pytesseract.image_to_string(img)
        return text
    except Exception:
        return None


# helper to save uploaded file stream to a path
def save_upload_file(upload_file, dest_path: str) -> str:
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "wb") as buffer:
        for chunk in upload_file.iter_bytes():
            buffer.write(chunk)
    return dest_path

