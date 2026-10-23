"""
Automated unit tests for frame_filter module.
Tests dHash calculation, Hamming distance, near-duplicate clustering, and representative selection.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from aeromorph_cv.frame_filter import (
    compute_dhash_64,
    dhash_to_hex,
    find_near_duplicates,
    hamming_distance,
)
from tests.test_image_quality import write_synthetic_bmp


class TestFrameFilter(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aeromorph_test_ff_")
        self.test_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_dhash_determinism_and_formatting(self):
        # A gradient image produces a deterministic non-zero hash
        gray = np.tile(np.linspace(0, 255, 64, dtype=np.uint8), (64, 1))
        h1 = compute_dhash_64(gray)
        h2 = compute_dhash_64(gray)

        self.assertEqual(h1, h2)
        hex_str = dhash_to_hex(h1)
        self.assertEqual(len(hex_str), 16)
        self.assertEqual(int(hex_str, 16), h1)

    def test_hamming_distance(self):
        self.assertEqual(hamming_distance(0, 0), 0)
        self.assertEqual(hamming_distance(0b0001, 0b0000), 1)
        self.assertEqual(hamming_distance(0b1111, 0b0000), 4)
        self.assertEqual(hamming_distance(0xFFFFFFFFFFFFFFFF, 0x0000000000000000), 64)

    def test_near_duplicate_detection(self):
        # Create 3 synthetic images:
        # img1: checkerboard
        # img2: checkerboard identical to img1
        # img3: totally different gradient
        img1 = write_synthetic_bmp(self.test_path / "frame_01.bmp", width=128, height=128, pattern="checker")
        img2 = write_synthetic_bmp(self.test_path / "frame_02_dup.bmp", width=128, height=128, pattern="checker")
        img3 = write_synthetic_bmp(self.test_path / "frame_03_diff.bmp", width=128, height=128, pattern="gradient")

        # Fake entries matching image_quality schema
        from aeromorph_cv.frame_filter import compute_image_dhash

        _, hash1 = compute_image_dhash(img1)
        _, hash2 = compute_image_dhash(img2)
        _, hash3 = compute_image_dhash(img3)

        entries = [
            {"filename": "frame_01.bmp", "status": "valid", "dhash": hash1, "blur_score": 150.0},
            {"filename": "frame_02_dup.bmp", "status": "valid", "dhash": hash2, "blur_score": 140.0},
            {"filename": "frame_03_diff.bmp", "status": "valid", "dhash": hash3, "blur_score": 50.0},
        ]

        pairs, groups = find_near_duplicates(entries, max_hamming_distance=4)

        # Expect frame_01 and frame_02_dup to be flagged as duplicates
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["image_a"], "frame_01.bmp")
        self.assertEqual(pairs[0]["image_b"], "frame_02_dup.bmp")
        self.assertEqual(pairs[0]["hamming_distance"], 0)
        self.assertEqual(pairs[0]["similarity_pct"], 100.0)

        # Group should select frame_01 as primary (higher blur_score: 150 vs 140)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["primary"], "frame_01.bmp")
        self.assertIn("frame_02_dup.bmp", groups[0]["duplicates"])


if __name__ == "__main__":
    unittest.main()
