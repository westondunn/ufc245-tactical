"""ufc.com event detail page -> per-fight preview blurbs."""
from __future__ import annotations

from bs4 import BeautifulSoup

from .base import fetch_text


def _slug(name: str) -> str:
    return "".join(c for c in name.lower().replace(" ", "-") if c.isalnum() or c == "-")


class UFCPreviewScraper:
    source_type = "ufc_preview"
    base = "https://www.ufc.com"

    def fetch_for_event_slug(self, slug: str) -> list[dict]:
        url = f"{self.base}/event/{slug}"
        html = fetch_text(url)
        if not html:
            return []
        soup = BeautifulSoup(html, "lxml")
        out: list[dict] = []
        for section in soup.select("section.c-listing-fight"):
            red = section.select_one(".c-listing-fight__corner-name--red")
            blue = section.select_one(".c-listing-fight__corner-name--blue")
            preview_node = section.select_one(".js-fight-preview, [data-fight-preview]")
            if not (red and blue):
                continue
            red_name = red.get_text(strip=True)
            blue_name = blue.get_text(strip=True)
            preview_text = ""
            if preview_node:
                preview_text = (preview_node.get("data-fight-preview")
                                or preview_node.get_text(" ", strip=True))
            preview_text = (preview_text or "").strip()
            if not preview_text:
                continue
            anchor = f"{_slug(red_name)}-vs-{_slug(blue_name)}"
            out.append({
                "url": f"{url}#{anchor}",
                "source_type": self.source_type,
                "body": preview_text,
                "red_name": red_name,
                "blue_name": blue_name,
            })
        return out
