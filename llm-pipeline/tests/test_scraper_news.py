from pathlib import Path
import respx
import httpx

from scrapers.news import NewsScraper

FIX = Path(__file__).parent / "fixtures"


@respx.mock
def test_news_scraper_filters_rss_to_relevant_items():
    rss = (FIX / "mmafighting_rss.xml").read_text()
    article = (FIX / "mmajunkie_article.html").read_text()
    respx.get("https://www.mmafighting.com/rss/current").mock(
        return_value=httpx.Response(200, text=rss, headers={"content-type": "application/rss+xml"})
    )
    respx.get("https://mmafighting.com/2026/04/volkanovski-coach").mock(
        return_value=httpx.Response(200, text=article)
    )
    scraper = NewsScraper(feeds=["https://www.mmafighting.com/rss/current"])
    items = scraper.fetch_for_fighters(["Volkanovski", "Topuria"])
    assert len(items) == 1
    assert "volkanovski" in items[0]["body"].lower()
    assert items[0]["url"].endswith("/volkanovski-coach")
    assert items[0]["source_type"] == "news_article"


@respx.mock
def test_news_scraper_returns_empty_when_no_match():
    rss = (FIX / "mmafighting_rss.xml").read_text()
    respx.get("https://www.mmafighting.com/rss/current").mock(
        return_value=httpx.Response(200, text=rss)
    )
    # No article URLs mocked because none should be requested.
    scraper = NewsScraper(feeds=["https://www.mmafighting.com/rss/current"])
    assert scraper.fetch_for_fighters(["NobodyMatching"]) == []
