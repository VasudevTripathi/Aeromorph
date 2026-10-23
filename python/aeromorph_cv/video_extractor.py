"""
Aeromorph CV: Video Frame Extractor & Quality Evaluation Module (Sprint 8)

Extracts candidate photograph frames from video files (MP4, MOV, AVI, MKV, WebM)
with configurable temporal sampling, blur detection, resolution filtering,
and perceptual difference hash (dHash) deduplication.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

# Reusable CV foundation modules from Sprint 7
from aeromorph_cv.frame_filter import compute_dhash_64, dhash_to_hex, hamming_distance
from aeromorph_cv.image_quality import compute_blur_score, compute_exposure_metrics

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

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def get_video_decoder_info() -> Dict[str, Any]:
    """Detect available local video decoding backends."""
    if HAS_OPENCV and cv2 is not None:
        return {
            "available": True,
            "backend": "opencv",
            "version": getattr(cv2, "__version__", "unknown"),
            "supported_formats": sorted(list(SUPPORTED_VIDEO_EXTENSIONS)),
            "message": "OpenCV VideoCapture backend available.",
        }

    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        return {
            "available": True,
            "backend": "ffmpeg",
            "version": ffmpeg_bin,
            "supported_formats": sorted(list(SUPPORTED_VIDEO_EXTENSIONS)),
            "message": f"FFmpeg binary detected at {ffmpeg_bin}.",
        }

    return {
        "available": False,
        "backend": "none",
        "version": None,
        "supported_formats": sorted(list(SUPPORTED_VIDEO_EXTENSIONS)),
        "message": (
            "No compatible video decoder is installed. "
            "Please install opencv-python-headless (pip install opencv-python-headless) "
            "or ensure FFmpeg is available in the system PATH."
        ),
    }


def is_supported_video_file(file_path: str | Path) -> bool:
    """Check if file extension corresponds to a supported video format."""
    ext = Path(file_path).suffix.lower()
    return ext in SUPPORTED_VIDEO_EXTENSIONS


def save_frame_to_image_file(frame_bgr: np.ndarray, output_path: Path) -> bool:
    """
    Save a BGR numpy image frame to disk using available encoders
    (OpenCV, Pillow, or pure NumPy uncompressed 24-bit BMP fallback).
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = output_path.suffix.lower()

    if HAS_OPENCV and cv2 is not None:
        try:
            if suffix in (".jpg", ".jpeg"):
                return bool(cv2.imwrite(str(output_path), frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95]))
            return bool(cv2.imwrite(str(output_path), frame_bgr))
        except Exception:
            pass

    if HAS_PILLOW and Image is not None:
        try:
            frame_rgb = frame_bgr[:, :, ::-1]
            pil_img = Image.fromarray(frame_rgb)
            if suffix in (".jpg", ".jpeg"):
                pil_img.save(str(output_path), quality=95)
            else:
                pil_img.save(str(output_path))
            return True
        except Exception:
            pass

    # Pure NumPy uncompressed 24-bit BMP fallback
    bmp_path = output_path.with_suffix(".bmp") if suffix not in (".bmp",) else output_path
    try:
        h, w = frame_bgr.shape[:2]
        row_bytes = w * 3
        row_padding = (4 - (row_bytes % 4)) % 4
        padded_row_bytes = row_bytes + row_padding
        img_size = padded_row_bytes * h
        file_size = 54 + img_size

        header = bytearray(54)
        header[0:2] = b"BM"
        header[2:6] = file_size.to_bytes(4, "little")
        header[10:14] = (54).to_bytes(4, "little")
        header[14:18] = (40).to_bytes(4, "little")
        header[18:22] = w.to_bytes(4, "little", signed=True)
        header[22:26] = (-h).to_bytes(4, "little", signed=True)  # Top-down
        header[26:28] = (1).to_bytes(2, "little")
        header[28:30] = (24).to_bytes(2, "little")
        header[30:34] = (0).to_bytes(4, "little")
        header[34:38] = img_size.to_bytes(4, "little")

        with open(bmp_path, "wb") as f:
            f.write(header)
            if row_padding == 0:
                f.write(frame_bgr.tobytes())
            else:
                pad = b"\x00" * row_padding
                for r in range(h):
                    f.write(frame_bgr[r].tobytes())
                    f.write(pad)
        return True
    except Exception:
        return False


def get_video_metadata_from_cap(cap: Any) -> Dict[str, Any]:
    """Retrieve frame dimensions, frame rate, and estimated duration from VideoCapture."""
    fps = 0.0
    total_frames = 0
    width = 0
    height = 0

    try:
        # 5: CAP_PROP_FPS, 7: CAP_PROP_FRAME_COUNT, 3: CAP_PROP_FRAME_WIDTH, 4: CAP_PROP_FRAME_HEIGHT
        fps_prop = cap.get(cv2.CAP_PROP_FPS if (HAS_OPENCV and cv2) else 5)
        if fps_prop and not np.isnan(fps_prop) and fps_prop > 0:
            fps = float(fps_prop)
    except Exception:
        fps = 0.0

    try:
        count_prop = cap.get(cv2.CAP_PROP_FRAME_COUNT if (HAS_OPENCV and cv2) else 7)
        if count_prop and not np.isnan(count_prop) and count_prop > 0:
            total_frames = int(count_prop)
    except Exception:
        total_frames = 0

    try:
        w_prop = cap.get(cv2.CAP_PROP_FRAME_WIDTH if (HAS_OPENCV and cv2) else 3)
        h_prop = cap.get(cv2.CAP_PROP_FRAME_HEIGHT if (HAS_OPENCV and cv2) else 4)
        if w_prop and h_prop:
            width = int(w_prop)
            height = int(h_prop)
    except Exception:
        pass

    duration_sec = (total_frames / fps) if (fps > 0 and total_frames > 0) else 0.0

    return {
        "width": width,
        "height": height,
        "fps": fps,
        "total_frames": total_frames,
        "duration_seconds": round(duration_sec, 2),
    }


def extract_video_frames(
    video_path: str | Path,
    output_dir: str | Path,
    output_report_path: Optional[str | Path] = None,
    job_id: Optional[str] = None,
    sampling_interval_sec: float = 1.0,
    max_frames: Optional[int] = None,
    min_dimension: int = 320,
    min_blur_score: float = 50.0,
    max_hamming: int = 8,
    filter_duplicates: bool = True,
    filter_blur: bool = False,
    video_capture_factory: Optional[Callable[[str], Any]] = None,
    progress_callback: Optional[Callable[[int, int, float, float, int, str], None]] = None,
) -> Dict[str, Any]:
    """
    Extract, evaluate, and save frames sequentially from a video file.

    Memory Efficiency:
    - Frames are processed one-by-one. The complete video is never held in memory.
    - Decoded frame matrices are dereferenced immediately after evaluation and saving.

    Safety:
    - Source video is never modified or deleted.
    - Candidate frames are written to an isolated output directory.
    """
    start_time = time.time()
    v_path = Path(video_path).resolve()

    if not v_path.exists():
        raise FileNotFoundError(f"Source video file does not exist: {v_path}")
    if not v_path.is_file():
        raise ValueError(f"Specified video path is not a regular file: {v_path}")

    ext = v_path.suffix.lower()
    if ext not in SUPPORTED_VIDEO_EXTENSIONS:
        raise ValueError(
            f"Unsupported video file extension '{ext}'. "
            f"Supported formats: {', '.join(sorted(list(SUPPORTED_VIDEO_EXTENSIONS)))}"
        )

    file_size_bytes = v_path.stat().st_size
    if file_size_bytes == 0:
        raise ValueError("Video file is empty (0 bytes).")

    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Initialize video capture backend
    cap = None
    decoder_used = "unknown"
    if video_capture_factory is not None:
        cap = video_capture_factory(str(v_path))
        decoder_used = "custom_factory"
    elif HAS_OPENCV and cv2 is not None:
        cap = cv2.VideoCapture(str(v_path))
        decoder_used = "opencv"
    else:
        raise RuntimeError(
            "No compatible video decoder is installed. "
            "Please install opencv-python-headless (`pip install opencv-python-headless`) "
            "to extract frames from video files."
        )

    if not hasattr(cap, "isOpened") or not cap.isOpened():
        raise RuntimeError(f"Video decoder could not open video file: {v_path.name}. File may be corrupted or codec unsupported.")

    # 2. Extract and sanitize video metadata
    meta = get_video_metadata_from_cap(cap)
    fps = meta["fps"]
    total_video_frames = meta["total_frames"]
    warnings: List[str] = []

    if fps <= 0.0 or np.isnan(fps):
        fps = 30.0
        warnings.append("Video metadata reports invalid frame rate (FPS). Fallback to default 30.0 fps.")

    sampling_interval = max(0.05, float(sampling_interval_sec))
    est_total_samples = int(meta["duration_seconds"] / sampling_interval) if meta["duration_seconds"] > 0 else (
        int(total_video_frames / (fps * sampling_interval)) if total_video_frames > 0 else 0
    )

    frame_idx = 0
    sampled_count = 0
    retained_count = 0
    rejected_count = 0
    unreadable_count = 0
    blurry_count = 0
    duplicate_count = 0
    low_res_count = 0

    last_sampled_time_sec: Optional[float] = None
    last_retained_dhash: Optional[int] = None
    last_retained_idx: Optional[int] = None
    last_retained_time_sec: Optional[float] = None

    frames_records: List[Dict[str, Any]] = []

    try:
        while True:
            ret, frame_bgr = cap.read()
            if not ret or frame_bgr is None:
                # Normal EOF or early termination
                break

            # Calculate frame timestamp (prefer POS_MSEC if valid, else frame_idx / fps)
            pos_msec = 0.0
            try:
                msec_prop = cap.get(cv2.CAP_PROP_POS_MSEC if (HAS_OPENCV and cv2) else 0)
                if msec_prop and not np.isnan(msec_prop) and msec_prop > 0:
                    pos_msec = float(msec_prop)
            except Exception:
                pos_msec = 0.0

            current_time_sec = (pos_msec / 1000.0) if pos_msec > 0 else (frame_idx / fps)

            # Check if this frame hits the sampling interval
            should_sample = False
            if last_sampled_time_sec is None:
                should_sample = True
            elif (current_time_sec - last_sampled_time_sec) >= (sampling_interval * 0.98):
                should_sample = True

            if should_sample:
                sampled_count += 1
                last_sampled_time_sec = current_time_sec

                h, w = frame_bgr.shape[:2]
                reasons: List[str] = []
                is_retained = True

                # Update metadata dimensions if not set initially
                if meta["width"] == 0 or meta["height"] == 0:
                    meta["width"] = w
                    meta["height"] = h

                # A. Dimension check
                if min(h, w) < min_dimension:
                    is_retained = False
                    low_res_count += 1
                    reasons.append(f"Resolution {w}x{h} below minimum required dimension {min_dimension}px")

                # B. Grayscale conversion for CV evaluation
                if HAS_OPENCV and cv2 is not None:
                    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
                else:
                    gray = (
                        0.114 * frame_bgr[:, :, 0]
                        + 0.587 * frame_bgr[:, :, 1]
                        + 0.299 * frame_bgr[:, :, 2]
                    ).astype(np.uint8)

                # C. Blur analysis (Laplacian variance)
                blur_score = compute_blur_score(gray)
                is_blurry = blur_score < min_blur_score
                if is_blurry:
                    blurry_count += 1
                    if filter_blur:
                        is_retained = False
                        reasons.append(f"Blur score {blur_score:.1f} below threshold {min_blur_score:.1f}")

                # D. Exposure analysis
                exposure_info = compute_exposure_metrics(gray)
                exposure_status = exposure_info["exposure_status"]
                if exposure_status in ("under_exposed", "over_exposed"):
                    reasons.append(f"Exposure warning: {exposure_status.replace('_', ' ')}")

                # E. Perceptual dHash & duplicate comparison
                dhash_int = compute_dhash_64(gray)
                dhash_str = dhash_to_hex(dhash_int)
                is_duplicate = False
                hamming_dist: Optional[int] = None

                if last_retained_dhash is not None:
                    hamming_dist = hamming_distance(dhash_int, last_retained_dhash)
                    if hamming_dist <= max_hamming:
                        is_duplicate = True
                        duplicate_count += 1
                        if filter_duplicates:
                            is_retained = False
                            reasons.append(
                                f"Near-duplicate of frame #{last_retained_idx} "
                                f"(Hamming distance {hamming_dist} <= {max_hamming})"
                            )

                out_filename = None
                out_filepath = None

                if is_retained:
                    retained_count += 1
                    out_filename = f"frame_{retained_count:05d}_{current_time_sec:07.2f}s.jpg"
                    out_filepath = str(out_dir / out_filename)
                    save_frame_to_image_file(frame_bgr, Path(out_filepath))

                    last_retained_dhash = dhash_int
                    last_retained_idx = retained_count
                    last_retained_time_sec = current_time_sec
                else:
                    rejected_count += 1

                frame_entry = {
                    "frame_index": frame_idx,
                    "sample_number": sampled_count,
                    "timestamp_sec": round(current_time_sec, 3),
                    "status": "retained" if is_retained else "rejected",
                    "filename": out_filename,
                    "output_path": out_filepath,
                    "dimensions": [w, h],
                    "blur_score": round(blur_score, 2),
                    "is_blurry": is_blurry,
                    "exposure_status": exposure_status,
                    "mean_brightness": exposure_info.get("mean_brightness", 0.0),
                    "contrast_std": exposure_info.get("contrast_std", 0.0),
                    "dhash": dhash_str,
                    "hamming_to_previous_retained": hamming_dist,
                    "rejection_reasons": reasons,
                }
                frames_records.append(frame_entry)

                pct = 0.0
                if total_video_frames > 0:
                    pct = min(100.0, (frame_idx / total_video_frames) * 100.0)
                elif meta["duration_seconds"] > 0:
                    pct = min(100.0, (current_time_sec / meta["duration_seconds"]) * 100.0)

                log_action = out_filename if is_retained else f"[skipped: {reasons[0] if reasons else 'filtered'}]"
                progress_msg = (
                    f"[PROGRESS] {sampled_count} sampled ({pct:.1f}%) "
                    f"extracted={retained_count} time={current_time_sec:.2f}s {log_action}"
                )
                print(progress_msg, flush=True)

                if progress_callback:
                    progress_callback(
                        sampled_count,
                        est_total_samples,
                        pct,
                        current_time_sec,
                        retained_count,
                        out_filename or "",
                    )

                # Stop if max_frames reached
                if max_frames is not None and retained_count >= max_frames:
                    print(f"[INFO] Reached requested max_frames limit ({max_frames}). Stopping extraction.", flush=True)
                    break

                del gray

            del frame_bgr
            frame_idx += 1

    finally:
        if hasattr(cap, "release"):
            cap.release()

    elapsed = round(time.time() - start_time, 2)

    # 3. Formulate readiness and recommendations
    recommendations: List[str] = []
    readiness = "ready"

    if retained_count < 2:
        readiness = "needs_attention"
        recommendations.append("Fewer than 2 frames were retained. Increase video duration or decrease sampling interval.")
    elif retained_count < 10:
        readiness = "ready_with_warnings"
        recommendations.append(
            f"Only {retained_count} frames extracted. High-fidelity 3D reconstruction typically benefits from 20+ overlapping views."
        )
    else:
        recommendations.append(
            f"{retained_count} candidate frames successfully extracted and evaluated in chronological sequence."
        )

    recommendations.append(
        "Important: Successful Structure-from-Motion (COLMAP) requires spatial parallax between frames. "
        "Videos recorded with camera translation (orbiting, walking, flying) succeed; "
        "stationary panning without camera movement lacks 3D parallax."
    )

    report_data: Dict[str, Any] = {
        "schema_version": "1.0",
        "job_id": job_id or f"vid_{int(time.time())}",
        "timestamp": time.time(),
        "source_video": {
            "path": str(v_path),
            "filename": v_path.name,
            "size_bytes": file_size_bytes,
        },
        "video_metadata": {
            "width": meta["width"],
            "height": meta["height"],
            "fps": round(fps, 2),
            "total_video_frames": total_video_frames,
            "duration_seconds": meta["duration_seconds"],
            "decoder_used": decoder_used,
        },
        "extraction_config": {
            "sampling_interval_sec": sampling_interval,
            "max_frames": max_frames,
            "min_dimension": min_dimension,
            "min_blur_score": min_blur_score,
            "max_hamming": max_hamming,
            "filter_duplicates": filter_duplicates,
            "filter_blur": filter_blur,
        },
        "summary": {
            "total_frames_sampled": sampled_count,
            "retained_frames_count": retained_count,
            "rejected_frames_count": rejected_count,
            "unreadable_frames_count": unreadable_count,
            "blurry_frames_count": blurry_count,
            "duplicate_frames_count": duplicate_count,
            "low_resolution_frames_count": low_res_count,
            "elapsed_seconds": elapsed,
        },
        "dataset_readiness": {
            "recommendation": readiness,
            "summary": (
                f"Extracted {retained_count} frames from {meta['duration_seconds']}s video "
                f"at {sampling_interval}s interval. ({duplicate_count} near-duplicates, {blurry_count} blur warnings)."
            ),
            "recommendations": recommendations,
        },
        "frames": frames_records,
        "warnings": warnings,
    }

    if output_report_path:
        rep_p = Path(output_report_path).resolve()
        rep_p.parent.mkdir(parents=True, exist_ok=True)
        tmp_rep = rep_p.with_suffix(".tmp.json")
        with open(tmp_rep, "w", encoding="utf-8") as f:
            json.dump(report_data, f, indent=2, ensure_ascii=False)
        tmp_rep.replace(rep_p)
        print(f"[REPORT_WRITTEN] {rep_p}", flush=True)

    return report_data


def main():
    """Command-line interface entry point for video frame extraction worker."""
    parser = argparse.ArgumentParser(
        description="Aeromorph CV: Video Frame Extractor & Quality Evaluator",
    )
    parser.add_argument("--video-path", help="Path to input video file")
    parser.add_argument("--output-dir", help="Directory where extracted frames will be saved")
    parser.add_argument("--output-report", help="Output path for structured JSON report")
    parser.add_argument("--job-id", default=None, help="Optional job ID for tracking")
    parser.add_argument("--sampling-interval", type=float, default=1.0, help="Sampling interval in seconds")
    parser.add_argument("--max-frames", type=int, default=None, help="Maximum number of frames to retain")
    parser.add_argument("--min-dimension", type=int, default=320, help="Minimum width or height")
    parser.add_argument("--min-blur-score", type=float, default=50.0, help="Blur variance threshold")
    parser.add_argument("--max-hamming", type=int, default=8, help="Max Hamming distance for near-duplicates")
    parser.add_argument("--filter-duplicates", action="store_true", default=True, help="Skip near-duplicates")
    parser.add_argument("--no-filter-duplicates", dest="filter_duplicates", action="store_false")
    parser.add_argument("--filter-blur", action="store_true", default=False, help="Discard blurry frames")
    parser.add_argument("--check-decoder", action="store_true", help="Print decoder capabilities and exit")

    args = parser.parse_args()

    if args.check_decoder:
        info = get_video_decoder_info()
        print(json.dumps(info, indent=2))
        sys.exit(0 if info["available"] else 1)

    if not args.video_path or not args.output_dir or not args.output_report:
        parser.print_help()
        sys.exit(1)

    try:
        extract_video_frames(
            video_path=args.video_path,
            output_dir=args.output_dir,
            output_report_path=args.output_report,
            job_id=args.job_id,
            sampling_interval_sec=args.sampling_interval,
            max_frames=args.max_frames,
            min_dimension=args.min_dimension,
            min_blur_score=args.min_blur_score,
            max_hamming=args.max_hamming,
            filter_duplicates=args.filter_duplicates,
            filter_blur=args.filter_blur,
        )
        print("[COMPLETED] Video frame extraction finished successfully.", flush=True)
        sys.exit(0)
    except Exception as err:
        print(f"[ERROR] {err}", file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
