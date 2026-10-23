"""
Pipeline orchestrator and CLI entry point for Aeromorph CV.

Sequences image discovery, incremental quality analysis, perceptual duplicate
clustering, and feature density evaluation. Generates structured JSON reports.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from aeromorph_cv.image_quality import (
    analyze_image_quality,
    is_supported_image_file,
    SUPPORTED_EXTENSIONS,
)
from aeromorph_cv.frame_filter import compute_dhash_64, dhash_to_hex, find_near_duplicates
from aeromorph_cv.feature_analysis import (
    extract_features_single,
    is_opencv_available,
)
from aeromorph_cv.image_quality import load_image_as_gray_and_rgb


def run_cv_pipeline(
    input_dir: str | Path,
    output_report_path: Optional[str | Path] = None,
    job_id: Optional[str] = None,
    extract_features: bool = True,
    max_hamming_distance: int = 4,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Execute full pre-flight computer vision analysis on an input photograph directory.
    Processes images incrementally without loading whole dataset into RAM.

    Args:
        input_dir: Path to directory containing photographs.
        output_report_path: Optional path to write output JSON report.
        job_id: Optional unique job identifier string.
        extract_features: Whether to perform keypoint density analysis if OpenCV is available.
        max_hamming_distance: Bit threshold for duplicate detection (default 4).
        progress_callback: Optional callable `fn(current, total, filename, pct)`.

    Returns:
        Structured report dictionary.
    """
    start_time = time.time()
    input_path = Path(input_dir).resolve()
    actual_job_id = job_id or f"cv_job_{int(start_time)}_{os.getpid()}"

    report: Dict[str, Any] = {
        "schema_version": "1.0",
        "job_id": actual_job_id,
        "timestamp": int(start_time),
        "input_directory": str(input_path),
        "opencv_available": is_opencv_available(),
        "summary": {
            "total_files_scanned": 0,
            "valid_images": 0,
            "unreadable_images": 0,
            "unsupported_files": 0,
            "blurry_images": 0,
            "exposure_warnings": 0,
            "low_resolution_images": 0,
            "likely_duplicates_count": 0,
            "duplicate_groups_count": 0,
            "dataset_readiness": "not_ready",
            "readiness_score": 0,
            "recommendations": [],
        },
        "images": [],
        "duplicate_groups": [],
        "duplicate_pairs": [],
    }

    if not input_path.exists() or not input_path.is_dir():
        report["summary"]["dataset_readiness"] = "not_ready"
        report["summary"]["recommendations"].append(
            f"Input directory does not exist or is not a directory: {input_dir}"
        )
        if output_report_path:
            write_report_file(output_report_path, report)
        return report

    # Collect and sort image files non-recursively for deterministic ordering
    all_entries = [p for p in input_path.iterdir() if p.is_file()]
    image_files = [p for p in all_entries if is_supported_image_file(p)]
    image_files.sort(key=lambda p: p.name.lower())

    total_count = len(image_files)
    report["summary"]["total_files_scanned"] = total_count

    if total_count == 0:
        report["summary"]["dataset_readiness"] = "not_ready"
        report["summary"]["recommendations"].append(
            f"No supported photographs found in directory. Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
        if output_report_path:
            write_report_file(output_report_path, report)
        return report

    # Incremental scan
    image_results = []
    blurry_count = 0
    exposure_warn_count = 0
    low_res_count = 0
    unreadable_count = 0
    valid_count = 0

    for idx, img_path in enumerate(image_files):
        pct = round(((idx + 1) / total_count) * 100.0, 1)

        # Notify via progress callback or stdout
        if progress_callback:
            progress_callback(idx + 1, total_count, img_path.name, pct)
        else:
            print(f"[PROGRESS] {idx + 1}/{total_count} ({pct}%) {img_path.name}", flush=True)

        entry = analyze_image_quality(img_path)

        # Compute dHash if image was decoded successfully
        if entry["status"] == "valid":
            valid_count += 1
            try:
                gray, _, _ = load_image_as_gray_and_rgb(img_path)
                h_val = compute_dhash_64(gray)
                entry["dhash"] = dhash_to_hex(h_val)

                # Feature analysis if requested
                if extract_features:
                    feat_stats = extract_features_single(gray)
                    entry["keypoints_detected"] = feat_stats.get("keypoints_detected", 0)
                    entry["keypoint_density"] = feat_stats.get("keypoint_density", 0.0)
                    entry["spatial_coverage_pct"] = feat_stats.get("spatial_coverage_pct", 0.0)
                    if feat_stats.get("warnings"):
                        entry["warnings"].extend(feat_stats["warnings"])

                del gray
            except Exception as h_err:
                entry["dhash"] = None
                entry["warnings"].append(f"Hash calculation failed: {h_err}")

            if entry.get("is_blurry"):
                blurry_count += 1
            if entry.get("exposure_status") in ("under_exposed", "over_exposed", "low_contrast"):
                exposure_warn_count += 1
            if any("Low resolution" in w for w in entry.get("warnings", [])):
                low_res_count += 1

        else:
            unreadable_count += 1

        image_results.append(entry)

    report["images"] = image_results

    # Near-duplicate analysis across the scanned hashes
    duplicate_pairs, duplicate_groups = find_near_duplicates(
        image_results, max_hamming_distance=max_hamming_distance
    )
    report["duplicate_pairs"] = duplicate_pairs
    report["duplicate_groups"] = duplicate_groups

    total_duplicate_images = sum(len(g["duplicates"]) for g in duplicate_groups)

    # Populate summary
    report["summary"]["valid_images"] = valid_count
    report["summary"]["unreadable_images"] = unreadable_count
    report["summary"]["blurry_images"] = blurry_count
    report["summary"]["exposure_warnings"] = exposure_warn_count
    report["summary"]["low_resolution_images"] = low_res_count
    report["summary"]["likely_duplicates_count"] = total_duplicate_images
    report["summary"]["duplicate_groups_count"] = len(duplicate_groups)

    # Calculate readiness score and classification
    score = 100
    recommendations = []

    if valid_count < 2:
        score = 0
        readiness = "not_ready"
        recommendations.append("At least 2 valid photographs are required for 3D triangulation.")
    else:
        # Deduct score for defects
        if unreadable_count > 0:
            score -= min(unreadable_count * 15, 30)
            recommendations.append(f"{unreadable_count} corrupt or unreadable image(s) detected. Remove or replace them.")

        if blurry_count > 0:
            blurry_ratio = blurry_count / valid_count
            score -= int(blurry_ratio * 35)
            recommendations.append(
                f"{blurry_count} image(s) flagged as blurry. Blurry images reduce 3D reconstruction accuracy."
            )

        if exposure_warn_count > 0:
            exp_ratio = exposure_warn_count / valid_count
            score -= int(exp_ratio * 20)
            recommendations.append(
                f"{exposure_warn_count} image(s) have exposure issues (under/over-exposed or flat contrast)."
            )

        if total_duplicate_images > 0:
            score -= min(total_duplicate_images * 5, 15)
            recommendations.append(
                f"{total_duplicate_images} likely near-duplicate frame(s) detected. Pruning redundant frames speeds up matching."
            )

        if valid_count < 5:
            recommendations.append("Dataset has fewer than 5 photos. Additional overlapping views recommended for 360° coverage.")

        score = max(min(score, 100), 0)

        if score >= 85 and unreadable_count == 0:
            readiness = "ready"
            recommendations.append("Dataset meets recommended photogrammetry quality guidelines.")
        elif score >= 60 and valid_count >= 2:
            readiness = "ready_with_warnings"
        elif valid_count >= 2:
            readiness = "needs_attention"
        else:
            readiness = "not_ready"

    report["summary"]["readiness_score"] = score
    report["summary"]["dataset_readiness"] = readiness
    report["summary"]["recommendations"] = recommendations
    report["summary"]["elapsed_seconds"] = round(time.time() - start_time, 2)

    # Dataset-level structured findings matching Electron bridge expectations
    report["dataset_summary"] = {
        "total_images_scanned": total_count,
        "acceptable_images_count": valid_count,
        "unreadable_images_count": unreadable_count,
        "blur_warnings_count": blurry_count,
        "exposure_warnings_count": exposure_warn_count,
        "low_resolution_images_count": low_res_count,
        "likely_duplicate_pairs_count": len(duplicate_pairs),
        "duplicate_clusters_count": len(duplicate_groups),
        "feature_analysis_status": "evaluated" if extract_features else "heuristic",
    }
    report["dataset_readiness"] = {
        "recommendation": readiness,
        "readiness_score": score,
        "summary": (
            f"Readiness: {readiness.replace('_', ' ').title()} ({score}/100 score). "
            f"{valid_count} acceptable of {total_count} images scanned."
        ),
        "recommendations": recommendations,
    }
    report["image_findings"] = [
        {
            "filename": img["filename"],
            "status": img["status"],
            "has_issues": bool(img.get("warnings") or img.get("is_blurry") or img["status"] != "valid"),
            "is_blurry": img.get("is_blurry", False),
            "blur_score": img.get("blur_score"),
            "exposure_status": img.get("exposure_status"),
            "issues": [{"message": w} for w in img.get("warnings", [])],
        }
        for img in image_results
    ]
    report["duplicate_detection"] = {
        "likely_duplicate_pairs": duplicate_pairs,
        "duplicate_clusters": duplicate_groups,
    }

    if output_report_path:
        write_report_file(output_report_path, report)

    return report


def write_report_file(report_path: str | Path, report_data: Dict[str, Any]):
    """Write structured JSON report safely to disk."""
    out_path = Path(report_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = out_path.with_suffix(".tmp.json")

    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)

    # Atomic rename
    temp_path.replace(out_path)


def main():
    """Command-line interface entry point."""
    parser = argparse.ArgumentParser(
        description="Aeromorph CV: Photograph Quality and Duplicate Pre-flight Worker",
    )
    parser.add_argument(
        "--input-dir",
        required=True,
        help="Path to folder containing source photographs",
    )
    parser.add_argument(
        "--output-report",
        required=False,
        default=None,
        help="Path to output JSON report file",
    )
    parser.add_argument(
        "--job-id",
        required=False,
        default=None,
        help="Optional job identifier",
    )
    parser.add_argument(
        "--max-hamming",
        type=int,
        default=4,
        help="Max bit distance for duplicate detection (default 4)",
    )
    parser.add_argument(
        "--skip-features",
        action="store_true",
        help="Skip OpenCV feature detection",
    )

    args = parser.parse_args()

    try:
        report = run_cv_pipeline(
            input_dir=args.input_dir,
            output_report_path=args.output_report,
            job_id=args.job_id,
            extract_features=not args.skip_features,
            max_hamming_distance=args.max_hamming,
        )

        summary = report["summary"]
        print(f"[SUMMARY] Total: {summary['total_files_scanned']}, Valid: {summary['valid_images']}, Blurry: {summary['blurry_images']}, Duplicates: {summary['likely_duplicates_count']}, Readiness: {summary['dataset_readiness']} ({summary['readiness_score']}%)", flush=True)

        if args.output_report:
            print(f"[SUCCESS] JSON report saved to: {args.output_report}", flush=True)

        sys.exit(0)

    except Exception as err:
        print(f"[ERROR] Pipeline execution failed: {err}", file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
