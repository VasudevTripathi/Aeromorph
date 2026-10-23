"""
Automated unit tests for pipeline module and JSON report generation.
Tests empty directories, full pipeline workflow, CLI invocation, and space-containing paths.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from aeromorph_cv.pipeline import run_cv_pipeline
from tests.test_image_quality import write_synthetic_bmp


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aeromorph_test_pipe_")
        self.test_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_empty_input_directory(self):
        empty_dir = self.test_path / "empty_folder"
        empty_dir.mkdir(parents=True, exist_ok=True)
        report_out = self.test_path / "empty_report.json"

        report = run_cv_pipeline(input_dir=empty_dir, output_report_path=report_out, job_id="test_empty")

        self.assertEqual(report["summary"]["total_files_scanned"], 0)
        self.assertEqual(report["summary"]["dataset_readiness"], "not_ready")
        self.assertEqual(report["summary"]["valid_images"], 0)
        self.assertTrue(any("No supported photographs found" in r for r in report["summary"]["recommendations"]))
        self.assertTrue(report_out.exists())

    def test_nonexistent_input_directory(self):
        non_dir = self.test_path / "does_not_exist"
        report = run_cv_pipeline(input_dir=non_dir)
        self.assertEqual(report["summary"]["dataset_readiness"], "not_ready")
        self.assertTrue(any("does not exist" in r for r in report["summary"]["recommendations"]))

    def test_full_pipeline_with_synthetic_dataset(self):
        # Create a dataset with 4 images:
        # img1: sharp checkerboard
        # img2: near-duplicate of img1
        # img3: smooth flat / blurry image
        # img4: gradient
        data_dir = self.test_path / "photos"
        data_dir.mkdir(parents=True, exist_ok=True)

        write_synthetic_bmp(data_dir / "img_01.bmp", width=120, height=120, pattern="checker")
        write_synthetic_bmp(data_dir / "img_02_dup.bmp", width=120, height=120, pattern="checker")
        write_synthetic_bmp(data_dir / "img_03_blurry.bmp", width=120, height=120, pattern="solid")
        write_synthetic_bmp(data_dir / "img_04_gradient.bmp", width=120, height=120, pattern="gradient")

        report_file = self.test_path / "quality_report.json"
        progress_events = []

        def on_prog(cur, tot, fn, pct):
            progress_events.append((cur, tot, fn, pct))

        report = run_cv_pipeline(
            input_dir=data_dir,
            output_report_path=report_file,
            job_id="test_job_100",
            progress_callback=on_prog,
        )

        # Check progress events
        self.assertEqual(len(progress_events), 4)
        self.assertEqual(progress_events[-1][1], 4)

        # Check report schema
        self.assertEqual(report["schema_version"], "1.0")
        self.assertEqual(report["job_id"], "test_job_100")
        self.assertEqual(report["summary"]["total_files_scanned"], 4)
        self.assertEqual(report["summary"]["valid_images"], 4)
        self.assertGreaterEqual(report["summary"]["blurry_images"], 1)
        self.assertGreaterEqual(report["summary"]["likely_duplicates_count"], 1)
        self.assertIn(report["summary"]["dataset_readiness"], ("ready_with_warnings", "needs_attention", "ready"))

        # Check JSON output on disk
        self.assertTrue(report_file.exists())
        with open(report_file, "r", encoding="utf-8") as f:
            disk_data = json.load(f)
        self.assertEqual(disk_data["job_id"], "test_job_100")
        self.assertEqual(len(disk_data["images"]), 4)

    def test_pipeline_with_directory_spaces(self):
        spaced_dir = self.test_path / "My Aerial Photos 2026"
        spaced_dir.mkdir(parents=True, exist_ok=True)
        write_synthetic_bmp(spaced_dir / "frame 01.bmp", width=100, height=100)
        write_synthetic_bmp(spaced_dir / "frame 02.bmp", width=100, height=100)

        report_file = self.test_path / "spaced report.json"
        report = run_cv_pipeline(input_dir=spaced_dir, output_report_path=report_file)

        self.assertEqual(report["summary"]["total_files_scanned"], 2)
        self.assertEqual(report["summary"]["valid_images"], 2)
        self.assertTrue(report_file.exists())

    def test_cli_execution_via_python_subprocess(self):
        data_dir = self.test_path / "cli_photos"
        data_dir.mkdir(parents=True, exist_ok=True)
        write_synthetic_bmp(data_dir / "photo_a.bmp", width=100, height=100)
        write_synthetic_bmp(data_dir / "photo_b.bmp", width=100, height=100)

        report_path = self.test_path / "cli_report.json"

        # Invoke python -m aeromorph_cv.pipeline
        python_root = Path(__file__).resolve().parent.parent
        env = os.environ.copy()
        env["PYTHONPATH"] = str(python_root)

        cmd = [
            sys.executable,
            "-m",
            "aeromorph_cv.pipeline",
            "--input-dir",
            str(data_dir),
            "--output-report",
            str(report_path),
            "--job-id",
            "cli_test_job",
        ]

        proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, f"CLI stderr: {proc.stderr}")
        self.assertIn("[PROGRESS]", proc.stdout)
        self.assertIn("[SUMMARY]", proc.stdout)
        self.assertTrue(report_path.exists())

        with open(report_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["job_id"], "cli_test_job")


if __name__ == "__main__":
    unittest.main()
