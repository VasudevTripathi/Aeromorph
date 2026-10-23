"""
Image quality analysis module for Aeromorph CV.

Evaluates dimensions, decoding integrity, blur (Laplacian variance),
brightness, contrast, and photogrammetric suitability.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

# Optional imports with graceful degradation
try:
    import cv2  # type: ignore
    HAS_OPENCV = True
except ImportError:
    cv2 = None
    HAS_OPENCV = False

try:
    from PIL import Image  # type: ignore
    HAS_PILLOW = True
except ImportError:
    Image = None
    HAS_PILLOW = False

SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
}

# Quality thresholds calibrated for photogrammetry preprocessing
BLUR_THRESHOLD = 80.0          # Below this variance, image is likely blurry
LOW_RES_MIN_PIXELS = 800 * 600 # 0.48 MP minimum recommended
LOW_RES_WARN_MP = 0.8          # Warning threshold in megapixels
UNDER_EXPOSED_MEAN = 40.0      # Too dark
OVER_EXPOSED_MEAN = 215.0      # Too bright / blown highlights
LOW_CONTRAST_STD = 22.0        # Washed out / flat contrast


def is_supported_image_file(file_path: str | Path) -> bool:
    """Check if file extension corresponds to a supported raster image format."""
    ext = Path(file_path).suffix.lower()
    return ext in SUPPORTED_EXTENSIONS


def load_image_as_gray_and_rgb(
    file_path: str | Path,
) -> Tuple[np.ndarray, np.ndarray, Tuple[int, int, int]]:
    """
    Safely load an image from disk into grayscale and RGB numpy arrays.
    Handles Windows paths containing spaces and non-ASCII characters without failing.

    Returns:
        (gray_array, rgb_array, (width, height, channels))
    Raises:
        FileNotFoundError: If path does not exist.
        ValueError: If file is zero-byte, corrupted, or unsupported.
    """
    path_obj = Path(file_path)
    if not path_obj.exists():
        raise FileNotFoundError(f"Image file does not exist: {file_path}")

    file_size = path_obj.stat().st_size
    if file_size < 16:
        raise ValueError(f"Image file is empty or too small ({file_size} bytes)")

    # Method 1: OpenCV if available (fast C++ decoders)
    if HAS_OPENCV and cv2 is not None:
        try:
            # np.fromfile handles Unicode / Windows long paths safely
            raw_data = np.fromfile(str(path_obj), dtype=np.uint8)
            bgr = cv2.imdecode(raw_data, cv2.IMREAD_COLOR)
            if bgr is not None and bgr.size > 0:
                h, w = bgr.shape[:2]
                c = bgr.shape[2] if len(bgr.shape) > 2 else 1
                gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                return gray, rgb, (w, h, c)
        except Exception as cv_err:
            # Fallback to Pillow if OpenCV failed on this specific format
            pass

    # Method 2: Pillow if available
    if HAS_PILLOW and Image is not None:
        try:
            with Image.open(str(path_obj)) as img:
                img.verify()
            # Re-open after verify() as recommended by Pillow documentation
            with Image.open(str(path_obj)) as img:
                rgb_img = img.convert("RGB")
                rgb = np.asarray(rgb_img, dtype=np.uint8)
                w, h = img.size
                c = 3
                # Luminance conversion: 0.299 R + 0.587 G + 0.114 B
                gray = (
                    0.299 * rgb[:, :, 0]
                    + 0.587 * rgb[:, :, 1]
                    + 0.114 * rgb[:, :, 2]
                ).astype(np.uint8)
                return gray, rgb, (w, h, c)
        except Exception as pil_err:
            raise ValueError(f"Decoding failed: {pil_err}") from pil_err

    # Method 3: Built-in 24-bit uncompressed BMP fallback for minimal environments
    if path_obj.suffix.lower() == ".bmp":
        try:
            with open(path_obj, "rb") as f:
                header = f.read(54)
                if len(header) >= 54 and header[:2] == b"BM":
                    data_offset = int.from_bytes(header[10:14], "little")
                    w = int.from_bytes(header[18:22], "little", signed=True)
                    h = int.from_bytes(header[22:26], "little", signed=True)
                    bpp = int.from_bytes(header[28:30], "little")
                    comp = int.from_bytes(header[30:34], "little")
                    if bpp == 24 and comp == 0 and w > 0 and h != 0:
                        is_top_down = h < 0
                        abs_h = abs(h)
                        row_len = ((w * 3 + 3) // 4) * 4
                        f.seek(data_offset)
                        pixel_bytes = f.read(row_len * abs_h)
                        if len(pixel_bytes) == row_len * abs_h:
                            raw = np.frombuffer(pixel_bytes, dtype=np.uint8).reshape((abs_h, row_len))
                            bgr = raw[:, : w * 3].reshape((abs_h, w, 3))
                            if not is_top_down:
                                bgr = np.flipud(bgr)
                            rgb = bgr[:, :, ::-1].copy()
                            gray = (
                                0.299 * rgb[:, :, 0]
                                + 0.587 * rgb[:, :, 1]
                                + 0.114 * rgb[:, :, 2]
                            ).astype(np.uint8)
                            return gray, rgb, (w, abs_h, 3)
        except Exception:
            pass

    # Method 4: No decoder available
    if not HAS_OPENCV and not HAS_PILLOW:
        raise RuntimeError(
            "Neither OpenCV (cv2) nor Pillow (PIL) is installed to decode image files."
        )

    raise ValueError("Image file could not be decoded as valid raster data.")


def compute_blur_score(gray: np.ndarray) -> float:
    """
    Compute blur metric using variance of the discrete 2D Laplacian.
    Higher values indicate sharp edges; lower values indicate blur.
    """
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0

    if HAS_OPENCV and cv2 is not None:
        try:
            lap = cv2.Laplacian(gray, cv2.CV_64F)
            return float(np.var(lap))
        except Exception:
            pass

    # Pure NumPy implementation of discrete 3x3 Laplacian:
    # Kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
    g = gray.astype(np.float64)
    lap = (
        g[:-2, 1:-1]
        + g[2:, 1:-1]
        + g[1:-1, :-2]
        + g[1:-1, 2:]
        - 4.0 * g[1:-1, 1:-1]
    )
    return float(np.var(lap))


def analyze_image_quality(file_path: str | Path) -> Dict[str, Any]:
    """
    Perform complete image quality analysis on a single image file.
    Does not keep image pixel buffers in memory.

    Returns:
        Structured dictionary containing dimensions, blur score, exposure metrics,
        and actionable warnings.
    """
    path_obj = Path(file_path)
    file_name = path_obj.name

    result: Dict[str, Any] = {
        "filename": file_name,
        "path": str(path_obj.resolve()),
        "status": "valid",
        "file_size_bytes": 0,
        "width": 0,
        "height": 0,
        "channels": 0,
        "megapixels": 0.0,
        "blur_score": 0.0,
        "is_blurry": False,
        "brightness_mean": 0.0,
        "contrast_std": 0.0,
        "exposure_status": "unknown",
        "warnings": [],
        "error": None,
    }

    try:
        if not path_obj.exists():
            result["status"] = "unreadable"
            result["error"] = "File not found"
            result["warnings"].append("File does not exist on disk")
            return result

        result["file_size_bytes"] = path_obj.stat().st_size

        if not is_supported_image_file(path_obj):
            result["status"] = "unsupported"
            result["error"] = f"Unsupported file extension: {path_obj.suffix}"
            result["warnings"].append(f"Format {path_obj.suffix} is not a supported photogrammetry format")
            return result

        gray, rgb, (w, h, c) = load_image_as_gray_and_rgb(path_obj)
        result["width"] = w
        result["height"] = h
        result["channels"] = c
        mp = round((w * h) / 1_000_000.0, 2)
        result["megapixels"] = mp

        # Resolution check
        total_pixels = w * h
        if total_pixels < LOW_RES_MIN_PIXELS:
            result["warnings"].append(
                f"Low resolution: {w}x{h} ({mp} MP). Minimum 800x600 recommended for 3D reconstruction."
            )
        elif mp < LOW_RES_WARN_MP:
            result["warnings"].append(
                f"Sub-optimal resolution: {mp} MP. Detailed keypoint matching may be reduced."
            )

        # Blur metric
        blur = round(compute_blur_score(gray), 2)
        result["blur_score"] = blur
        if blur < BLUR_THRESHOLD:
            result["is_blurry"] = True
            result["warnings"].append(
                f"Blurry photograph detected (score: {blur} < threshold {BLUR_THRESHOLD}). May produce noisy 3D points."
            )

        # Brightness & Contrast
        b_mean = round(float(np.mean(gray)), 2)
        c_std = round(float(np.std(gray)), 2)
        result["brightness_mean"] = b_mean
        result["contrast_std"] = c_std

        if b_mean < UNDER_EXPOSED_MEAN:
            result["exposure_status"] = "under_exposed"
            result["warnings"].append(
                f"Under-exposed / dark image (mean brightness {b_mean}/255). SIFT features in shadows may fail to match."
            )
        elif b_mean > OVER_EXPOSED_MEAN:
            result["exposure_status"] = "over_exposed"
            result["warnings"].append(
                f"Over-exposed / blown highlights (mean brightness {b_mean}/255). Washed-out textures lack distinct features."
            )
        elif c_std < LOW_CONTRAST_STD:
            result["exposure_status"] = "low_contrast"
            result["warnings"].append(
                f"Low contrast / washed out (std {c_std}). Flat surfaces may cause feature tracking failure."
            )
        else:
            result["exposure_status"] = "good"

        # Explicitly release references to image data
        del gray
        del rgb

    except Exception as err:
        result["status"] = "unreadable"
        result["error"] = str(err)
        result["warnings"].append(f"Image decoding failed: {err}")

    return result
