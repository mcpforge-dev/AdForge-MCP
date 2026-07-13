from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ad_mcp.tools.site_analysis import SiteAnalysisError, _validate_public_url


VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "mobile": {"width": 390, "height": 844},
}


def _timestamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d-%H%M%S")


def _audit_page(page) -> dict[str, Any]:  # noqa: ANN001
    return page.evaluate(
        """
        () => {
          const doc = document.documentElement;
          const body = document.body;
          const all = Array.from(document.querySelectorAll("*"));
          const overflow = all
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 90),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              };
            })
            .filter((item) => item.width > 0 && (item.left < -2 || item.right > window.innerWidth + 2))
            .slice(0, 20);
          const buttonsWithoutName = Array.from(document.querySelectorAll("button,a,[role='button']"))
            .filter((el) => !(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim())
            .length;
          const imagesWithoutAlt = Array.from(document.images).filter((img) => !img.getAttribute("alt")).length;
          const h1 = Array.from(document.querySelectorAll("h1")).map((el) => el.innerText.trim()).filter(Boolean);
          const ctas = Array.from(document.querySelectorAll("button,a,[role='button']"))
            .map((el) => (el.innerText || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 16);
          return {
            title: document.title || "",
            url: location.href,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: { width: doc.scrollWidth, height: Math.max(doc.scrollHeight, body ? body.scrollHeight : 0) },
            overflow,
            h1,
            ctas,
            accessibility: { buttons_without_name: buttonsWithoutName, images_without_alt: imagesWithoutAlt },
          };
        }
        """
    )


def run(url: str, output_dir: Path) -> dict[str, Any]:
    target = _validate_public_url(url)
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - depends on optional local tooling.
        raise RuntimeError("Playwright is not installed. Install optional dependency: pip install -e .[site-audit].") from exc

    run_dir = output_dir / _timestamp()
    run_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, Any] = {"url": target, "output_dir": str(run_dir), "viewports": {}}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage", "--no-sandbox"])
        for name, viewport in VIEWPORTS.items():
            page = browser.new_page(viewport=viewport)
            page.goto(target, wait_until="domcontentloaded", timeout=15_000)
            try:
                page.wait_for_load_state("networkidle", timeout=3000)
            except Exception:
                pass
            screenshot_path = run_dir / f"{name}.png"
            page.screenshot(path=str(screenshot_path), full_page=True, type="png", timeout=7000)
            facts = _audit_page(page)
            facts["screenshot"] = str(screenshot_path)
            result["viewports"][name] = facts
            page.close()
        browser.close()
    report_path = run_dir / "audit.json"
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    result["report"] = str(report_path)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture desktop/mobile screenshots and basic UI audit facts.")
    parser.add_argument("url", help="Public http/https URL to audit")
    parser.add_argument("--output-dir", default=".local/design-audit", help="Ignored local output directory")
    args = parser.parse_args()
    try:
        result = run(args.url, Path(args.output_dir))
    except SiteAnalysisError as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, ensure_ascii=False))
        return 2
    except RuntimeError as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"status": "ok", "report": result["report"], "output_dir": result["output_dir"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
