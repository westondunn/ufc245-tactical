"""Shared scraper helpers: polite fetch + HTML cleanup."""
from __future__ import annotations
import time

import httpx
from bs4 import BeautifulSoup

USER_AGENT = "UFC-Tactical-LLM-Pipeline/0.1 (github.com/westondunn/ufc245-tactical)"


def fetch_text(url: str, *, timeout: float = 20.0) -> str | None:
    try:
        r = httpx.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def extract_main_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    # Prefer <article>, fall back to body, strip script/style.
    target = soup.find("article") or soup.body or soup
    for bad in target.find_all(["script", "style", "nav", "header", "footer", "aside"]):
        bad.decompose()
    text = target.get_text("\n", strip=True)
    # Collapse runs of blank lines.
    return "\n".join(line for line in text.splitlines() if line.strip())


def polite_sleep(seconds: float = 1.0) -> None:
    time.sleep(seconds)
