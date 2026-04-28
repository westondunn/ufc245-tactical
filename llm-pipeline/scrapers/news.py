"""News scraper. Reads RSS feeds, fetches article HTML, filters to fighter mentions."""
from __future__ import annotations
import logging
from typing import Iterable

import feedparser

from .base import fetch_text, extract_main_text, polite_sleep

logger = logging.getLogger(__name__)

DEFAULT_FEEDS = [
    "https://www.mmafighting.com/rss/current",
    "https://mmajunkie.usatoday.com/feed",
    "https://www.bloodyelbow.com/rss/current",
]


def _mentions_any(text: str, names: Iterable[str]) -> bool:
    lowered = text.lower()
    return any(n.lower() in lowered for n in names if n)


class NewsScraper:
    source_type = "news_article"

    def __init__(self, feeds: list[str] | None = None):
        self.feeds = feeds or DEFAULT_FEEDS

    def fetch_for_fighters(self, fighter_names: list[str]) -> list[dict]:
        out: list[dict] = []
        for feed_url in self.feeds:
            raw = fetch_text(feed_url)
            if not raw:
                logger.warning("rss fetch failed: %s", feed_url)
                continue
            parsed = feedparser.parse(raw)
            for entry in parsed.entries:
                blob = " ".join([entry.get("title", ""), entry.get("summary", "")])
                if not _mentions_any(blob, fighter_names):
                    continue
                url = entry.get("link")
                if not url:
                    continue
                polite_sleep(1.0)
                html = fetch_text(url)
                if not html:
                    continue
                body = extract_main_text(html)
                if not _mentions_any(body, fighter_names):
                    continue
                out.append({"url": url, "source_type": self.source_type, "body": body,
                            "title": entry.get("title", "")})
        return out
