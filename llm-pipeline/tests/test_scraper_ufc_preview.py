from pathlib import Path
import respx
import httpx
from scrapers.ufc_preview import UFCPreviewScraper

FIX = Path(__file__).parent / "fixtures"


@respx.mock
def test_extracts_preview_blocks_per_fight():
    html = (FIX / "ufc_event_preview.html").read_text()
    respx.get("https://www.ufc.com/event/ufc-fake").mock(return_value=httpx.Response(200, text=html))
    scraper = UFCPreviewScraper()
    items = scraper.fetch_for_event_slug("ufc-fake")
    assert len(items) == 1
    assert "Volkanovski" in items[0]["body"]
    assert "Topuria" in items[0]["body"]
    assert items[0]["source_type"] == "ufc_preview"
    assert items[0]["url"] == "https://www.ufc.com/event/ufc-fake#volkanovski-vs-topuria"
