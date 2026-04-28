"""Tapology fighter-page scraper. Extracts camp, weight cut, recent activity."""
from __future__ import annotations
from bs4 import BeautifulSoup

from .base import fetch_text


class TapologyScraper:
    source_type = "tapology_fighter"
    base = "https://www.tapology.com/fightcenter/fighters"

    def fetch_for_fighter_slug(self, slug: str) -> dict | None:
        url = f"{self.base}/{slug}"
        html = fetch_text(url)
        if not html:
            return None
        soup = BeautifulSoup(html, "lxml")
        # Pull the "details" panel and the recent fights summary as the body.
        sections: list[str] = []
        details = soup.select_one(".details_two_columns")
        if details:
            sections.append(details.get_text("\n", strip=True))
        history = soup.select_one(".fighterFightHistory")
        if history:
            sections.append(history.get_text("\n", strip=True))
        upcoming = soup.select_one(".fighterUpcomingHeader")
        if upcoming:
            sections.append(upcoming.get_text("\n", strip=True))
        body = "\n\n".join(s for s in sections if s)
        if not body:
            return None
        return {"url": url, "source_type": self.source_type, "body": body}
