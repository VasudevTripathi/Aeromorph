"""
Automated unit tests for feature_analysis module.
Tests keypoint density analysis and graceful handling of missing optional dependencies.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

import aeromorph_cv.feature_analysis as fa
from tests.test_image_quality import write_synthetic_bmp


class TestFeatureAnalysis(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aeromorph_test_fa_")
        self.test_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_missing_opencv_graceful_handling(self):
        # Force HAS_OPENCV to False to simulate environment without cv2
        with patch.object(fa, "HAS_OPENCV", False), patch.object(fa, "cv2", None):
            self.assertFalse(fa.is_opencv_available())

            gray = np.zeros((100, 100), dtype=np.uint8)
            stats = fa.extract_features_single(gray)
            self.assertFalse(stats["available"])
            self.assertEqual(stats["status"], "opencv_missing")
            self.assertIn("OpenCV (cv2) is not installed", stats["message"])

            overlap = fa.estimate_pairwise_overlap(gray, gray)
            self.assertFalse(overlap["available"])
            self.assertEqual(overlap["status"], "opencv_missing")

    def test_opencv_feature_extraction_if_available(self):
        if not fa.is_opencv_available():
            self.skipTest("OpenCV (cv2) is not installed in the current Python environment; verified fallback behavior.")

        # Test on a synthetic textured checkerboard
        img_path = write_synthetic_bmp(self.test_path / "textured.bmp", width=256, height=256, pattern="checker")
        res = fa.analyze_image_features(img_path)

        self.assertTrue(res["available"])
        self.assertEqual(res["status"], "computed")
        self.assertGreater(res["keypoints_detected"], 0)
        self.assertGreater(res["spatial_coverage_pct"], 0.0)


if __name__ == "__main__":
    unittest.main()
