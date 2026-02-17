#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from app.config import get_settings
from app.scraping.http_client import RetryHttpClient
from app.scraping.service import DevpostScraper
from app.snapshot_builder import build_snapshot_from_targets, discover_hackathon_targets


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build snapshot JSON shards for fast frontend winner lookup.")
    parser.add_argument(
        "--limit",
        type=int,
        default=1000,
        help="Maximum number of hackathons to include (default: 1000).",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=300,
        help="Maximum number of Devpost API listing pages to scan (default: 300).",
    )
    parser.add_argument(
        "--scrape-concurrency",
        type=int,
        default=4,
        help="Concurrent scrape workers for building shards (default: 4).",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="../frontend/public/snapshots",
        help="Output directory for manifest/shards (default: ../frontend/public/snapshots).",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if args.limit < 1:
        raise SystemExit("--limit must be >= 1")
    if args.max_pages < 1:
        raise SystemExit("--max-pages must be >= 1")
    if args.scrape_concurrency < 1:
        raise SystemExit("--scrape-concurrency must be >= 1")

    settings = get_settings()
    http_client = RetryHttpClient(settings)
    scraper = DevpostScraper(http_client=http_client, settings=settings)

    output_dir = Path(args.output).expanduser().resolve()

    try:
        print(f"Discovering targets (limit={args.limit}, max_pages={args.max_pages})...")
        targets = await discover_hackathon_targets(http_client, limit=args.limit, max_pages=args.max_pages)
        print(f"Discovered {len(targets)} target hackathon(s).")

        report = await build_snapshot_from_targets(
            scraper,
            targets=targets,
            output_dir=output_dir,
            scrape_concurrency=args.scrape_concurrency,
            scope={
                "selection_mode": "ended_preferred",
                "limit": args.limit,
                "max_pages": args.max_pages,
            },
        )
    finally:
        await http_client.close()

    print("")
    print("Snapshot build complete.")
    print(f"Manifest: {report.manifest_path}")
    print(f"Selected targets: {report.selected_count}")
    print(f"Successful shards: {report.success_count}")
    print(f"Failed shards: {report.failure_count}")
    print(f"Pruned stale shards: {report.pruned_shard_count}")
    print(f"Output size: {report.total_output_bytes} bytes")
    print(f"Duration: {report.duration_seconds:.2f}s")

    if report.failed_targets:
        print("")
        print("Failed targets:")
        for failed in report.failed_targets[:50]:
            print(f"  - {failed['hackathon_url']}: {failed['error']}")
        if len(report.failed_targets) > 50:
            print(f"  ... and {len(report.failed_targets) - 50} more")


if __name__ == "__main__":
    asyncio.run(main())
