from pathlib import Path
import respx
import httpx
from scrapers.tapology import TapologyScraper

FIX = Path(__file__).parent / "fixtures"


@respx.mock
def test_tapology_extracts_camp_and_weighin_blob():
    html = (FIX / "tapology_fighter.html").read_text()
    respx.get("https://www.tapology.com/fightcenter/fighters/alexander-volkanovski").mock(
        return_value=httpx.Response(200, text=html)
    )
    scraper = TapologyScraper()
    item = scraper.fetch_for_fighter_slug("alexander-volkanovski")
    assert item is not None
    assert "City Kickboxing" in item["body"]
    assert "145.5" in item["body"]
    assert item["source_type"] == "tapology_fighter"


@respx.mock
def test_tapology_returns_none_on_404():
    respx.get("https://www.tapology.com/fightcenter/fighters/nobody").mock(
        return_value=httpx.Response(404, text="not found")
    )
    scraper = TapologyScraper()
    assert scraper.fetch_for_fighter_slug("nobody") is None
