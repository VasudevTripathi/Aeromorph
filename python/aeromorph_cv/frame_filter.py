"""
Near-duplicate image detection and perceptual similarity filter for Aeromorph CV.

Identifies near-duplicate frames and burst-shot redundancies using
lightweight 64-bit difference hashing (dHash) and Hamming distance clustering.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

from aeromorph_cv.image_quality import load_image_as_gray_and_rgb

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


def compute_dhash_64(gray: np.ndarray) -> int:
    """
    Compute a 64-bit difference hash (dHash) from a grayscale image.
    Downscales to 9 columns x 8 rows, comparing adjacent horizontal pixels.
    """
    target_w, target_h = 9, 8

    # Resize using OpenCV or Pillow
    if HAS_OPENCV and cv2 is not None:
        resized = cv2.resize(gray, (target_w, target_h), interpolation=cv2.INTER_AREA)
    elif HAS_PILLOW and Image is not None:
        pil_img = Image.fromarray(gray)
        resized_pil = pil_img.resize((target_w, target_h), Image.Resampling.BILINEAR)
        resized = np.asarray(resized_pil, dtype=np.uint8)
    else:
        # Fallback pure NumPy block averaging resize
        h, w = gray.shape
        row_bins = np.linspace(0, h, target_h + 1, dtype=int)
        col_bins = np.linspace(0, w, target_w + 1, dtype=int)
        resized = np.zeros((target_h, target_w), dtype=np.float64)
        for r in range(target_h):
            for c in range(target_w):
                block = gray[row_bins[r]:row_bins[r + 1], col_bins[c]:col_bins[c + 1]]
                resized[r, c] = np.mean(block) if block.size > 0 else 0.0

    # Compare horizontal neighbors: pixel[r, c] > pixel[r, c + 1]
    diff = resized[:, :-1] > resized[:, 1:]
    
    # Pack 8x8 = 64 boolean values into a 64-bit integer
    hash_val = 0
    for bit in diff.flatten():
        hash_val = (hash_val << 1) | int(bit)

    return int(hash_val)


def dhash_to_hex(hash_val: int) -> str:
    """Format 64-bit hash as a 16-character zero-padded hex string."""
    return f"{hash_val:016x}"


def hamming_distance(hash_a: int, hash_b: int) -> int:
    """Compute Hamming distance (differing bits) between two 64-bit hashes."""
    return bin(hash_a ^ hash_b).count("1")


def compute_image_dhash(file_path: str | Path) -> Tuple[Optional[int], Optional[str]]:
    """
    Load an image and compute its 64-bit dHash.
    Returns (hash_int, hash_hex) or (None, None) if image cannot be read.
    """
    try:
        gray, _, _ = load_image_as_gray_and_rgb(file_path)
        h_int = compute_dhash_64(gray)
        del gray
        return h_int, dhash_to_hex(h_int)
    except Exception:
        return None, None


def find_near_duplicates(
    image_entries: List[Dict[str, Any]],
    max_hamming_distance: int = 4,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Identify near-duplicate pairs and cluster them into duplicate groups.
    
    Args:
        image_entries: List of image quality records containing 'filename', 'dhash', and 'blur_score'.
        max_hamming_distance: Maximum bit difference (0-64) to be flagged as near-duplicate.
                             Default 4 bits (~94% visual similarity).

    Returns:
        (duplicate_pairs, duplicate_groups)
    """
    valid_items = [
        item for item in image_entries
        if item.get("status") == "valid" and item.get("dhash") is not None
    ]

    # Pre-parse hex hashes into integer values
    parsed = []
    for item in valid_items:
        try:
            val = int(item["dhash"], 16)
            parsed.append((item, val))
        except (ValueError, TypeError):
            continue

    pairs = []
    parent_map: Dict[str, str] = {}

    def find_root(name: str) -> str:
        if parent_map.setdefault(name, name) == name:
            return name
        parent_map[name] = find_root(parent_map[name])
        return parent_map[name]

    def union(name_a: str, name_b: str):
        root_a = find_root(name_a)
        root_b = find_root(name_b)
        if root_a != root_b:
            parent_map[root_b] = root_a

    # Pairwise comparison
    n = len(parsed)
    for i in range(n):
        item_a, hash_a = parsed[i]
        name_a = item_a["filename"]

        for j in range(i + 1, n):
            item_b, hash_b = parsed[j]
            name_b = item_b["filename"]

            dist = hamming_distance(hash_a, hash_b)
            if dist <= max_hamming_distance:
                sim_pct = round((64 - dist) / 64.0 * 100.0, 1)
                pairs.append({
                    "image_a": name_a,
                    "image_b": name_b,
                    "hamming_distance": dist,
                    "similarity_pct": sim_pct,
                })
                union(name_a, name_b)

    # Group into connected clusters
    clusters: Dict[str, List[Dict[str, Any]]] = {}
    for item, _ in parsed:
        name = item["filename"]
        root = find_root(name)
        clusters.setdefault(root, []).append(item)

    duplicate_groups = []
    for root, members in clusters.items():
        if len(members) > 1:
            # Pick primary representative with highest sharpness / blur score
            sorted_members = sorted(
                members,
                key=lambda x: (x.get("blur_score", 0.0), x.get("megapixels", 0.0)),
                reverse=True,
            )
            primary = sorted_members[0]["filename"]
            duplicates = [m["filename"] for m in sorted_members[1:]]

            duplicate_groups.append({
                "primary": primary,
                "duplicates": duplicates,
                "total_in_group": len(members),
                "recommendation": f"Consider keeping {primary} and reviewing/pruning {len(duplicates)} near-duplicate(s).",
            })

    return pairs, duplicate_groups
