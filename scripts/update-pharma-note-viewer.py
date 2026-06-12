#!/usr/bin/env python3
"""Update the browser viewer data for pharma_i_cist note articles."""

from __future__ import annotations

import html
import json
import re
import time
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT / "data" / "pharma_note_articles.json"
USERNAME = "pharma_i_cist"
PROFILE_URL = f"https://note.com/{USERNAME}"
API_BASE = f"https://note.com/api/v2/creators/{USERNAME}/contents"
START_DATE = "2025-03-16"
START_AT = datetime.fromisoformat(f"{START_DATE}T00:00:00+09:00")

GENERIC_TAGS = {
    "ai",
    "生成ai",
    "毎日note",
    "毎日更新",
    "仕事",
    "note",
}

KEYWORD_TAGS = [
    "ChatGPT",
    "OpenAI",
    "Claude",
    "Gemini",
    "Google",
    "LLM",
    "AIエージェント",
    "NotebookLM",
    "プロンプト",
    "論文",
    "研究",
    "セキュリティ",
    "調剤薬局",
    "薬局",
    "薬剤師",
    "患者",
]

CATEGORY_RULES = [
    ("blog", r"近況|自己紹介|ブログ|SNS|家族|子供|日記"),
    ("security", r"セキュリティ|脆弱|攻撃|漏洩|詐欺|フィッシング|パスワード|インシデント|リスク|プライバシー|規制|法律|監査"),
    ("literacy", r"リテラシー|教育|学習|倫理|安全性|社会|人間|未来|ハルシネーション|バイアス|評価|責任"),
    ("usage", r"活用|使う|作る|試す|プロンプト|ツール|アプリ|業務|効率|Dify|NotebookLM|PowerPoint|Chrome|チャットボット"),
    ("news", r"研究|論文|発表|報告|開発|リリース|ニュース|Nature|arxiv|JAMA|NEDO|モデル|システム"),
]


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if value:
            self.parts.append(value)

    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.parts)).strip()


def strip_html(value: str | None) -> str:
    parser = TextExtractor()
    parser.feed(value or "")
    return html.unescape(parser.text())


def request_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "accept": "application/json",
            "user-agent": "Mozilla/5.0 pharma-note-viewer-updater",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def excerpt(value: str, length: int = 180) -> str:
    text = re.sub(r"\s+", " ", strip_html(value)).strip()
    if len(text) <= length:
        return text
    return text[:length].rstrip() + "…"


def normalize_hashtags(item: dict) -> list[str]:
    tags: list[str] = []
    for entry in item.get("hashtags") or []:
        tag = entry.get("hashtag", {}).get("name") or entry.get("name") or ""
        tag = tag.replace("#", "").strip()
        if tag and tag.lower() not in GENERIC_TAGS and tag not in tags:
            tags.append(tag)
    return tags


def keyword_tags(document: str) -> list[str]:
    found: list[str] = []
    for tag in KEYWORD_TAGS:
        if tag.lower() in document.lower() and tag not in found:
            found.append(tag)
    return found


def classify(document: str) -> str:
    scores: list[tuple[int, int, str]] = []
    for index, (category, pattern) in enumerate(CATEGORY_RULES):
        hits = len(re.findall(pattern, document, re.I))
        if hits:
            scores.append((hits, -index, category))
    if not scores:
        return "blog"
    scores.sort(reverse=True)
    return scores[0][2]


def load_existing() -> dict[str, dict]:
    if not OUT_FILE.exists():
        return {}
    payload = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    articles = payload.get("articles", payload if isinstance(payload, list) else [])
    return {str(article.get("id") or article.get("key")): article for article in articles}


def fetch_articles(existing: dict[str, dict]) -> list[dict]:
    articles_by_key: dict[str, dict] = {}
    for page in range(1, 101):
        listing = request_json(f"{API_BASE}?kind=note&page={page}")
        contents = listing.get("data", {}).get("contents", [])
        if not contents:
            break

        for item in contents:
            publish_at = item.get("publishAt") or item.get("publish_at")
            key = item.get("key")
            if not publish_at or not key:
                continue
            if datetime.fromisoformat(publish_at) < START_AT:
                continue

            prior = existing.get(key) or {}
            document = " ".join(
                [
                    item.get("name", ""),
                    strip_html(item.get("description") or ""),
                    strip_html(item.get("body") or ""),
                ]
            )
            tags = prior.get("tags") or normalize_hashtags(item) + keyword_tags(document)
            deduped_tags = list(dict.fromkeys(tags))[:8]
            summary = prior.get("summary") or excerpt(
                item.get("description") or item.get("body") or item.get("name") or ""
            )

            articles_by_key[key] = {
                "id": key,
                "title": item.get("name", "").strip() or "無題の記事",
                "url": item.get("noteUrl") or f"{PROFILE_URL}/n/{key}",
                "date": publish_at[:10],
                "category": prior.get("category") or classify(document),
                "tags": deduped_tags,
                "summary": summary,
            }

        oldest = contents[-1].get("publishAt") or contents[-1].get("publish_at")
        if oldest and datetime.fromisoformat(oldest) < START_AT:
            break
        time.sleep(0.25)

    return sorted(articles_by_key.values(), key=lambda article: article["date"], reverse=True)


def main() -> None:
    existing = load_existing()
    articles = fetch_articles(existing)
    payload = {
        "source": PROFILE_URL,
        "api": API_BASE,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "startDate": START_DATE,
        "timezone": "Asia/Tokyo",
        "articleCount": len(articles),
        "articles": articles,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    previous = OUT_FILE.read_text(encoding="utf-8") if OUT_FILE.exists() else ""
    next_text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    OUT_FILE.write_text(next_text, encoding="utf-8")

    latest = articles[0] if articles else {}
    changed = "updated" if previous != next_text else "unchanged"
    print(
        f"{changed}: {len(articles)} articles. "
        f"Latest: {latest.get('date', 'n/a')} {latest.get('title', 'n/a')}"
    )


if __name__ == "__main__":
    main()
