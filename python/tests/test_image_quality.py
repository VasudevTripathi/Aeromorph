"""
Automated unit tests for image_quality module.
Tests valid loading, unreadable files, blur scores, exposure, and resolution checks.
"""

from __future__ import annotations

import os
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from aeromorph_cv.image_quality import (
    analyze_image_quality,
    compute_blur_score,
    is_supported_image_file,
    load_image_as_gray_and_rgb,
    BLUR_THRESHOLD,
)


def write_synthetic_bmp(
    file_path: str | Path,
    width: int,
    height: int,
    pattern: str = "solid",
    base_color: int = 128,
) -> Path:
    """
    Generate an uncompressed 24-bit Windows BMP image file directly with pure binary headers.
    Requires no external imaging libraries.
    """
    path_obj = Path(file_path)
    path_obj.parent.mkdir(parents=True, exist_ok=True)

    row_bytes = width * 3
    padding = (4 - (row_bytes % 4)) % 4
    padded_row_size = row_bytes + padding
    pixel_data_size = padded_row_size * height
    file_size = 54 + pixel_data_size

    # BMP Header (14 bytes) + DIB Header (40 bytes)
    header = bytearray(54)
    struct.pack_into(
        "<2sIHHI",
        header,
        0,
        b"BM",
        file_size,
        0,
        0,
        54,
    )
    struct.pack_into(
        "<IIIHHIIIIII",
        header,
        14,
        40,          # DIB header size
        width,       # Width
        height,      # Height
        1,           # Planes
        24,          # 24 bits per pixel (BGR)
        0,           # BI_RGB (no compression)
        pixel_data_size,
        2835,        # 72 DPI
        2835,
        0,
        0,
    )

    # Pixel data (bottom-to-top in BMP)
    pixel_data = bytearray(pixel_data_size)

    for y in range(height):
        row_offset = y * padded_row_size
        for x in range(width):
            pixel_offset = row_offset + x * 3
            if pattern == "solid":
                val = base_color
            elif pattern == "gradient":
                val = int((x / max(width - 1, 1)) * 255)
            elif pattern == "checker":
                val = 240 if ((x // 16) + (y // 16)) % 2 == 0 else 15
            elif pattern == "sharp_edges":
                # Alternating high-frequency stripes for high Laplacian variance
                val = 255 if (x % 4 < 2) else 0
            elif pattern == "noisy":
                val = (x * 37 + y * 59) % 256
            else:
                val = base_color

            val = max(0, min(255, val))
            # BGR order
            pixel_data[pixel_offset] = val
            pixel_data[pixel_offset + 1] = val
            pixel_data[pixel_offset + 2] = val

    with open(path_obj, "wb") as f:
        f.write(header)
        f.write(pixel_data)

    return path_obj


class TestImageQuality(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aeromorph_test_iq_")
        self.test_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_supported_extensions(self):
        self.assertTrue(is_supported_image_file("photo.jpg"))
        self.assertTrue(is_supported_image_file("scan.PNG"))
        self.assertTrue(is_supported_image_file("dataset/frame.BMP"))
        self.assertTrue(is_supported_image_file("d:/img.TIFF"))
        self.assertFalse(is_supported_image_file("data.json"))
        self.assertFalse(is_supported_image_file("run.exe"))

    def test_valid_image_loading(self):
        bmp_path = write_synthetic_bmp(self.test_path / "valid.bmp", width=100, height=80, pattern="checker")
        gray, rgb, (w, h, c) = load_image_as_gray_and_rgb(bmp_path)

        self.assertEqual(w, 100)
        self.assertEqual(h, 80)
        self.assertEqual(c, 3)
        self.assertEqual(gray.shape, (80, 100))
        self.assertEqual(rgb.shape, (80, 100, 3))
        self.assertGreater(float(np.mean(gray)), 0.0)

    def test_unreadable_and_corrupt_files(self):
        # 1. Non-existent file
        res_missing = analyze_image_quality(self.test_path / "non_existent.jpg")
        self.assertEqual(res_missing["status"], "unreadable")
        self.assertIn("File not found", res_missing["error"])

        # 2. Corrupt / truncated file
        corrupt_path = self.test_path / "corrupt.bmp"
        with open(corrupt_path, "wb") as f:
            f.write(b"BM\x00\x00corrupt_truncated_bytes")

        res_corrupt = analyze_image_quality(corrupt_path)
        self.assertEqual(res_corrupt["status"], "unreadable")
        self.assertIsNotNone(res_corrupt["error"])

    def test_low_resolution_image_detection(self):
        # 300x200 = 0.06 MP (far below 800x600 recommended)
        low_res_path = write_synthetic_bmp(self.test_path / "low_res.bmp", width=300, height=200)
        res = analyze_image_quality(low_res_path)

        self.assertEqual(res["status"], "valid")
        self.assertEqual(res["width"], 300)
        self.assertEqual(res["height"], 200)
        self.assertTrue(any("Low resolution" in w for w in res["warnings"]))

    def test_blur_and_sharpness_detection(self):
        # Flat solid color has 0 variance (completely blurry / flat)
        solid_path = write_synthetic_bmp(self.test_path / "smooth.bmp", width=120, height=120, pattern="solid")
        res_smooth = analyze_image_quality(solid_path)
        self.assertEqual(res_smooth["blur_score"], 0.0)
        self.assertTrue(res_smooth["is_blurry"])

        # Sharp alternating pattern has high Laplacian variance
        sharp_path = write_synthetic_bmp(self.test_path / "sharp.bmp", width=120, height=120, pattern="sharp_edges")
        res_sharp = analyze_image_quality(sharp_path)
        self.assertGreater(res_sharp["blur_score"], BLUR_THRESHOLD)
        self.assertFalse(res_sharp["is_blurry"])

    def test_exposure_detection(self):
        # Under-exposed / black
        dark_path = write_synthetic_bmp(self.test_path / "dark.bmp", width=100, height=100, pattern="solid", base_color=15)
        res_dark = analyze_image_quality(dark_path)
        self.assertEqual(res_dark["exposure_status"], "under_exposed")

        # Over-exposed / white
        bright_path = write_synthetic_bmp(self.test_path / "bright.bmp", width=100, height=100, pattern="solid", base_color=245)
        res_bright = analyze_image_quality(bright_path)
        self.assertEqual(res_bright["exposure_status"], "over_exposed")

        # Good exposure with contrast
        gradient_path = write_synthetic_bmp(self.test_path / "good.bmp", width=100, height=100, pattern="gradient")
        res_gradient = analyze_image_quality(gradient_path)
        self.assertEqual(res_gradient["exposure_status"], "good")

    def test_paths_with_spaces_and_special_characters(self):
        spaced_dir = self.test_path / "Dataset Folder With Spaces"
        spaced_dir.mkdir(parents=True, exist_ok=True)
        img_path = write_synthetic_bmp(spaced_dir / "my photograph 01.bmp", width=100, height=100)

        res = analyze_image_quality(img_path)
        self.assertEqual(res["status"], "valid")
        self.assertEqual(res["width"], 100)


if __name__ == "__main__":
    unittest.main()
