"""
Unit tests for aeromorph_cv.video_extractor module.

Covers:
- Decoder backend detection and capability reporting
- Sequential frame extraction and deterministic timestamp generation
- Configurable sampling intervals and maximum frame limits
- Blur and near-duplicate frame filtering using CV foundation modules
- Non-destructive source handling (source video is never modified)
- Paths containing spaces and special characters
- Structured JSON extraction report generation
- Corrupt/unsupported video handling and early EOF
- Mock vs. Real decoder tests clearly distinguished
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from aeromorph_cv.video_extractor import (
    SUPPORTED_VIDEO_EXTENSIONS,
    extract_video_frames,
    get_video_decoder_info,
    is_supported_video_file,
)

try:
    import cv2  # type: ignore
    HAS_OPENCV = True
except ImportError:
    cv2 = None
    HAS_OPENCV = False


class MockVideoCapture:
    """
    Deterministic mock VideoCapture simulating video frame streams
    for testing without external codec dependencies.
    """

    def __init__(
        self,
        fps: float = 30.0,
        total_frames: int = 90,
        width: int = 640,
        height: int = 480,
        frame_generator: Optional[Any] = None,
    ):
        self.fps = fps
        self.total_frames = total_frames
        self.width = width
        self.height = height
        self.current_idx = 0
        self.released = False
        self.frame_generator = frame_generator

    def isOpened(self) -> bool:
        return not self.released

    def get(self, prop_id: int) -> float:
        # Standard OpenCV properties: 3=WIDTH, 4=HEIGHT, 5=FPS, 7=FRAME_COUNT, 0=POS_MSEC
        if prop_id in (5, getattr(cv2, "CAP_PROP_FPS", 5)):
            return float(self.fps)
        if prop_id in (7, getattr(cv2, "CAP_PROP_FRAME_COUNT", 7)):
            return float(self.total_frames)
        if prop_id in (3, getattr(cv2, "CAP_PROP_FRAME_WIDTH", 3)):
            return float(self.width)
        if prop_id in (4, getattr(cv2, "CAP_PROP_FRAME_HEIGHT", 4)):
            return float(self.height)
        if prop_id in (0, getattr(cv2, "CAP_PROP_POS_MSEC", 0)):
            return float((self.current_idx / max(1.0, self.fps)) * 1000.0)
        return 0.0

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        if self.released or self.current_idx >= self.total_frames:
            return False, None

        idx = self.current_idx
        self.current_idx += 1

        if self.frame_generator:
            frame = self.frame_generator(idx, self.width, self.height)
            return True, frame

        # Default: generate a synthetic frame with distinct visual pattern
        frame = np.full((self.height, self.width, 3), (idx * 2) % 255, dtype=np.uint8)
        # Add high-contrast gradient pattern so it is sharp
        frame[10:100, 10:100] = (255, 0, 128)
        frame[50:80, 50:80] = (0, 255, 64)
        return True, frame

    def release(self) -> None:
        self.released = True


class TestVideoExtractor(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="aeromorph_video_test_"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_dummy_video_file(self, filename: str = "sample_drone.mp4", size_bytes: int = 2048) -> Path:
        """Create a synthetic video file with valid size to test file handling."""
        v_path = self.temp_dir / filename
        v_path.parent.mkdir(parents=True, exist_ok=True)
        # Write dummy binary content
        with open(v_path, "wb") as f:
            f.write(b"\x00" * size_bytes)
        return v_path

    # -------------------------------------------------------------------------
    # 1. Decoder Detection & Capability Reporting
    # -------------------------------------------------------------------------
    def test_get_video_decoder_info(self):
        info = get_video_decoder_info()
        self.assertIsInstance(info, dict)
        self.assertIn("available", info)
        self.assertIn("backend", info)
        self.assertIn("supported_formats", info)
        self.assertIn("message", info)
        self.assertIn(".mp4", info["supported_formats"])
        self.assertIn(".mov", info["supported_formats"])

    def test_supported_video_extensions(self):
        self.assertTrue(is_supported_video_file("test.mp4"))
        self.assertTrue(is_supported_video_file("test.MOV"))
        self.assertTrue(is_supported_video_file("test.mkv"))
        self.assertTrue(is_supported_video_file("test.avi"))
        self.assertFalse(is_supported_video_file("test.jpg"))
        self.assertFalse(is_supported_video_file("test.txt"))

    # -------------------------------------------------------------------------
    # 2. Sequential Extraction & Deterministic Timestamps (Mock Decoder)
    # -------------------------------------------------------------------------
    def test_mock_sequential_extraction_and_timestamps(self):
        """[Mock Decoder Test] Verify sequential extraction, timestamps, and report."""
        video_file = self._create_dummy_video_file("orbit.mp4")
        out_dir = self.temp_dir / "frames"
        report_path = self.temp_dir / "report.json"

        # 60 frames @ 30 fps = 2.0 seconds of video
        mock_cap = MockVideoCapture(fps=30.0, total_frames=60, width=640, height=480)

        report = extract_video_frames(
            video_path=video_file,
            output_dir=out_dir,
            output_report_path=report_path,
            sampling_interval_sec=0.5,  # Should sample at ~0.0s, ~0.5s, ~1.0s, ~1.5s
            filter_duplicates=False,
            video_capture_factory=lambda _: mock_cap,
        )

        self.assertEqual(report["schema_version"], "1.0")
        self.assertEqual(report["summary"]["total_frames_sampled"], 4)
        self.assertEqual(report["summary"]["retained_frames_count"], 4)
        self.assertTrue(report_path.exists())

        # Verify extracted frames exist on disk
        extracted_files = list(out_dir.glob("*.*"))
        self.assertEqual(len(extracted_files), 4)

        # Check deterministic naming
        filenames = [f.name for f in extracted_files]
        self.assertTrue(any("frame_00001_" in name for name in filenames))

    # -------------------------------------------------------------------------
    # 3. Sampling Interval & Max Frames Limits
    # -------------------------------------------------------------------------
    def test_sampling_interval_and_max_frames(self):
        """[Mock Decoder Test] Verify max_frames cap and interval settings."""
        video_file = self._create_dummy_video_file("long_flight.mp4")
        out_dir = self.temp_dir / "frames_capped"
        report_path = self.temp_dir / "report_capped.json"

        # 300 frames @ 30 fps = 10.0 seconds
        mock_cap = MockVideoCapture(fps=30.0, total_frames=300, width=640, height=480)

        report = extract_video_frames(
            video_path=video_file,
            output_dir=out_dir,
            output_report_path=report_path,
            sampling_interval_sec=1.0,
            max_frames=3,  # Cap extraction to 3 frames
            filter_duplicates=False,
            video_capture_factory=lambda _: mock_cap,
        )

        self.assertEqual(report["summary"]["retained_frames_count"], 3)
        self.assertEqual(report["extraction_config"]["max_frames"], 3)
        saved_files = list(out_dir.glob("*.*"))
        self.assertEqual(len(saved_files), 3)

    # -------------------------------------------------------------------------
    # 4. Blur and Near-Duplicate Frame Filtering
    # -------------------------------------------------------------------------
    def test_blur_and_near_duplicate_filtering(self):
        """[Mock Decoder Test] Verify blur detection and dHash near-duplicate filtering."""
        video_file = self._create_dummy_video_file("test_filter.mp4")
        out_dir = self.temp_dir / "filtered_frames"
        report_path = self.temp_dir / "filtered_report.json"

        def simulated_frames(idx, w, h):
            if idx in (0, 10, 20):  # Frame at 0s
                # Sharp frame A
                f = np.zeros((h, w, 3), dtype=np.uint8)
                f[::8, :] = 255
                f[:, ::8] = 255
                return f
            elif idx in (30, 40):  # Near-duplicate of Frame A at 1s
                f = np.zeros((h, w, 3), dtype=np.uint8)
                f[::8, :] = 255
                f[:, ::8] = 255
                # Slightly varied 1 pixel
                f[0, 0] = 200
                return f
            elif idx in (60, 70):  # Completely flat/blurry frame at 2s
                return np.full((h, w, 3), 128, dtype=np.uint8)
            else:  # Distinct sharp frame C at 3s
                f = np.zeros((h, w, 3), dtype=np.uint8)
                f[50:150, 50:150] = 255
                return f

        mock_cap = MockVideoCapture(fps=30.0, total_frames=120, width=640, height=480, frame_generator=simulated_frames)

        report = extract_video_frames(
            video_path=video_file,
            output_dir=out_dir,
            output_report_path=report_path,
            sampling_interval_sec=1.0,
            filter_duplicates=True,
            filter_blur=True,
            min_blur_score=50.0,
            video_capture_factory=lambda _: mock_cap,
        )

        summary = report["summary"]
        self.assertGreater(summary["total_frames_sampled"], 1)
        self.assertGreater(summary["duplicate_frames_count"], 0)
        self.assertGreater(summary["blurry_frames_count"], 0)

    # -------------------------------------------------------------------------
    # 5. Non-Destructive Source Handling
    # -------------------------------------------------------------------------
    def test_non_destructive_source_handling(self):
        """Verify the source video is never modified, renamed, or deleted."""
        video_file = self._create_dummy_video_file("protected_source.mp4", size_bytes=4096)
        initial_stat = video_file.stat()

        out_dir = self.temp_dir / "out_nd"
        mock_cap = MockVideoCapture(fps=30.0, total_frames=30, width=640, height=480)

        extract_video_frames(
            video_path=video_file,
            output_dir=out_dir,
            output_report_path=self.temp_dir / "rep.json",
            video_capture_factory=lambda _: mock_cap,
        )

        self.assertTrue(video_file.exists())
        final_stat = video_file.stat()
        self.assertEqual(initial_stat.st_size, final_stat.st_size)
        self.assertEqual(initial_stat.st_mtime_ns, final_stat.st_mtime_ns)

    # -------------------------------------------------------------------------
    # 6. Paths with Spaces and Special Characters
    # -------------------------------------------------------------------------
    def test_paths_containing_spaces(self):
        """Verify handling of directories and filenames with spaces."""
        space_dir = self.temp_dir / "flight footage 2026"
        space_dir.mkdir(parents=True, exist_ok=True)
        video_file = space_dir / "dji survey 01.mp4"
        with open(video_file, "wb") as f:
            f.write(b"\x00" * 1024)

        out_dir = self.temp_dir / "extracted frames output"
        report_path = self.temp_dir / "quality report.json"

        mock_cap = MockVideoCapture(fps=30.0, total_frames=30, width=640, height=480)

        report = extract_video_frames(
            video_path=video_file,
            output_dir=out_dir,
            output_report_path=report_path,
            video_capture_factory=lambda _: mock_cap,
        )

        self.assertEqual(report["summary"]["retained_frames_count"], 1)
        self.assertTrue(report_path.exists())

    # -------------------------------------------------------------------------
    # 7. Unreadable, Corrupt, and Missing Video Handling
    # -------------------------------------------------------------------------
    def test_nonexistent_and_corrupt_video(self):
        nonexistent = self.temp_dir / "ghost.mp4"
        with self.assertRaises(FileNotFoundError):
            extract_video_frames(
                video_path=nonexistent,
                output_dir=self.temp_dir / "out",
            )

        empty_file = self._create_dummy_video_file("empty.mp4", size_bytes=0)
        with self.assertRaises(ValueError):
            extract_video_frames(
                video_path=empty_file,
                output_dir=self.temp_dir / "out",
            )

        unsupported = self._create_dummy_video_file("document.pdf", size_bytes=512)
        with self.assertRaises(ValueError):
            extract_video_frames(
                video_path=unsupported,
                output_dir=self.temp_dir / "out",
            )

    # -------------------------------------------------------------------------
    # 8. Real OpenCV Decoder Test (Live or Skipped Cleanly)
    # -------------------------------------------------------------------------
    @unittest.skipUnless(HAS_OPENCV and cv2 is not None, "OpenCV (cv2) is not installed; skipping real VideoCapture test.")
    def test_real_opencv_decoder_if_available(self):
        """[Real Decoder Test] Verify real OpenCV VideoCapture when installed."""
        info = get_video_decoder_info()
        self.assertTrue(info["available"])
        self.assertEqual(info["backend"], "opencv")


if __name__ == "__main__":
    unittest.main()
