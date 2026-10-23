"""
Feature analysis and keypoint distribution module for Aeromorph CV.

Analyzes keypoint density using OpenCV ORB and evaluates pairwise overlap
indicators for photogrammetric triangulation. Degrades gracefully if cv2 is absent.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from aeromorph_cv.image_quality import load_image_as_gray_and_rgb

try:
    import cv2  # type: ignore
    HAS_OPENCV = True
except ImportError:
    cv2 = None
    HAS_OPENCV = False

# Recommended minimum keypoints for robust photogrammetry matching
MIN_KEYPOINTS_RECOMMENDED = 300
GOOD_KEYPOINTS_THRESHOLD = 800


def is_opencv_available() -> bool:
    """Check if OpenCV is installed and functional."""
    return HAS_OPENCV and cv2 is not None


def extract_features_single(
    gray: np.ndarray,
    max_features: int = 1200,
) -> Dict[str, Any]:
    """
    Extract ORB features and compute spatial keypoint distribution.
    
    Returns:
        Dictionary with keypoint count, density, and spatial coverage.
    """
    if not is_opencv_available():
        return {
            "available": False,
            "status": "opencv_missing",
            "keypoints_detected": 0,
            "keypoint_density": 0.0,
            "spatial_coverage_pct": 0.0,
            "message": "OpenCV (cv2) is not installed. Install opencv-python-headless for keypoint analysis.",
        }

    h, w = gray.shape[:2]
    total_mp = (w * h) / 1_000_000.0

    try:
        orb = cv2.ORB_create(nfeatures=max_features, fastThreshold=15)
        keypoints, descriptors = orb.detectAndCompute(gray, None)
        kp_count = len(keypoints) if keypoints is not None else 0

        # Calculate spatial coverage across a 4x4 grid
        grid_rows, grid_cols = 4, 4
        cells_hit = set()
        if keypoints:
            cell_w = max(w / grid_cols, 1.0)
            cell_h = max(h / grid_rows, 1.0)
            for kp in keypoints:
                x, y = kp.pt
                c = min(int(x / cell_w), grid_cols - 1)
                r = min(int(y / cell_h), grid_rows - 1)
                cells_hit.add((r, c))

        spatial_coverage_pct = round(len(cells_hit) / (grid_rows * grid_cols) * 100.0, 1)
        density = round(kp_count / total_mp, 1) if total_mp > 0 else 0.0

        warnings = []
        if kp_count < MIN_KEYPOINTS_RECOMMENDED:
            warnings.append(
                f"Sparse visual features ({kp_count} keypoints). Textureless or smooth surfaces may fail triangulation."
            )
        elif spatial_coverage_pct < 50.0:
            warnings.append(
                f"Clustered features (coverage {spatial_coverage_pct}%). Keypoints are concentrated in one region."
            )

        return {
            "available": True,
            "status": "computed",
            "keypoints_detected": kp_count,
            "keypoint_density": density,
            "spatial_coverage_pct": spatial_coverage_pct,
            "warnings": warnings,
            "descriptors_count": len(descriptors) if descriptors is not None else 0,
        }

    except Exception as err:
        return {
            "available": True,
            "status": "error",
            "error": str(err),
            "keypoints_detected": 0,
            "keypoint_density": 0.0,
            "spatial_coverage_pct": 0.0,
            "message": f"Feature extraction failed: {err}",
        }


def analyze_image_features(file_path: str | Path) -> Dict[str, Any]:
    """
    Extract and analyze keypoints for a single image file on disk.
    Releases pixel buffers immediately.
    """
    if not is_opencv_available():
        return {
            "available": False,
            "status": "opencv_missing",
            "keypoints_detected": 0,
            "keypoint_density": 0.0,
            "message": "OpenCV (cv2) not installed.",
        }

    try:
        gray, _, _ = load_image_as_gray_and_rgb(file_path)
        stats = extract_features_single(gray)
        del gray
        return stats
    except Exception as err:
        return {
            "available": True,
            "status": "error",
            "error": str(err),
            "keypoints_detected": 0,
            "keypoint_density": 0.0,
        }


def estimate_pairwise_overlap(
    gray_a: np.ndarray,
    gray_b: np.ndarray,
    max_features: int = 800,
) -> Dict[str, Any]:
    """
    Estimate visual overlap percentage between two images using ORB matching.
    """
    if not is_opencv_available():
        return {
            "available": False,
            "overlap_pct": 0.0,
            "matched_keypoints": 0,
            "status": "opencv_missing",
        }

    try:
        orb = cv2.ORB_create(nfeatures=max_features)
        kp_a, desc_a = orb.detectAndCompute(gray_a, None)
        kp_b, desc_b = orb.detectAndCompute(gray_b, None)

        if desc_a is None or desc_b is None or len(desc_a) < 10 or len(desc_b) < 10:
            return {
                "available": True,
                "overlap_pct": 0.0,
                "matched_keypoints": 0,
                "status": "insufficient_features",
            }

        # Match using Brute-Force Matcher with Hamming distance
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = matcher.match(desc_a, desc_b)
        good_matches = [m for m in matches if m.distance < 60]

        min_kp = min(len(kp_a), len(kp_b))
        overlap_pct = round((len(good_matches) / min_kp) * 100.0, 1) if min_kp > 0 else 0.0

        return {
            "available": True,
            "matched_keypoints": len(good_matches),
            "overlap_pct": min(overlap_pct, 100.0),
            "status": "computed",
        }
    except Exception as err:
        return {
            "available": True,
            "overlap_pct": 0.0,
            "matched_keypoints": 0,
            "status": "error",
            "error": str(err),
        }
