const DATA_URL = "data/pharma_note_articles.json";
const PROFILE_URL = "https://note.com/pharma_i_cist";

const categories = [
  { id: "news", label: "AIニュース・研究" },
  { id: "usage", label: "生成AI活用案" },
  { id: "literacy", label: "AIリテラシー" },
  { id: "security", label: "IT・情報セキュリティ" },
  { id: "blog", label: "ブログ運営・その他" },
];

const state = {
  articles: [],
  query: "",
  category: "all",
  tag: "",
  sort: "relevance",
};

const elements = {
  totalArticles: document.querySelector("#totalArticles"),
  summaryGrid: document.querySelector("#summaryGrid"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  categories: document.querySelector("#categories"),
  articleList: document.querySelector("#articleList"),
  resultCount: document.querySelector("#resultCount"),
  activeFilter: document.querySelector("#activeFilter"),
  downloadButton: document.querySelector("#downloadButton"),
};

const categoryById = new Map(categories.map((category) => [category.id, category]));
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const japaneseStopTerms = new Set([
  "する",
  "した",
  "して",
  "され",
  "れる",
  "ある",
  "いる",
  "これ",
  "それ",
  "ため",
  "こと",
  "もの",
  "よう",
  "から",
  "について",
  "という",
  "ます",
  "です",
  "では",
  "には",
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[＃#]/g, " ")
    .replace(/[、。，．・/／\\|:：;；!?！？()[\]{}「」『』【】"'“”‘’<>〈〉《》\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addSearchTerm(terms, value, weight) {
  const term = normalizeSearchText(value);
  if (!term || term.length < 2 || japaneseStopTerms.has(term)) return;
  terms.set(term, Math.max(terms.get(term) || 0, weight));
}

function addJapaneseNgrams(terms, value) {
  const chars = [...value];
  if (chars.length < 3) return;

  for (const size of [2, 3]) {
    for (let i = 0; i <= chars.length - size; i += 1) {
      const gram = chars.slice(i, i + size).join("");
      if (!/[\p{Script=Han}\p{Script=Katakana}]/u.test(gram)) continue;
      addSearchTerm(terms, gram, size === 2 ? 0.45 : 0.7);
    }
  }
}

function buildQueryProfile(query) {
  const normalized = normalizeSearchText(query);
  const terms = new Map();

  if (!normalized) return { normalized, terms: [] };
  if (normalized.length >= 4) addSearchTerm(terms, normalized, 5);

  const segments = normalized.match(/[a-z0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu) || [];
  segments.forEach((segment) => {
    if (/^[a-z0-9]+$/u.test(segment)) {
      addSearchTerm(terms, segment, segment.length >= 4 ? 2.4 : 1.6);
      return;
    }

    const kanjiTerms = segment.match(/\p{Script=Han}{2,}/gu) || [];
    kanjiTerms.forEach((term) => addSearchTerm(terms, term, 2.8));

    const katakanaTerms = segment.match(/[\p{Script=Katakana}ー]{2,}/gu) || [];
    katakanaTerms.forEach((term) => addSearchTerm(terms, term, 2.4));

    if (segment.length <= 8 && /[\p{Script=Han}\p{Script=Katakana}]/u.test(segment)) {
      addSearchTerm(terms, segment, 1.8);
    }
    addJapaneseNgrams(terms, segment);
  });

  return {
    normalized,
    terms: [...terms.entries()].map(([value, weight]) => ({ value, weight })),
  };
}

function buildArticleSearchText(article) {
  return {
    title: normalizeSearchText(article.title),
    summary: normalizeSearchText(article.summary),
    category: normalizeSearchText(getCategoryLabel(article.category)),
    tags: normalizeSearchText(article.tags.join(" ")),
  };
}

function scoreArticle(article, queryProfile) {
  if (!queryProfile.terms.length) return 0;

  const fields = buildArticleSearchText(article);
  const haystack = `${fields.title} ${fields.summary} ${fields.category} ${fields.tags}`;
  let score = 0;

  if (queryProfile.normalized.length >= 4) {
    if (fields.title.includes(queryProfile.normalized)) score += 12;
    if (fields.summary.includes(queryProfile.normalized)) score += 7;
  }

  queryProfile.terms.forEach(({ value, weight }) => {
    if (!haystack.includes(value)) return;
    score += weight;
    if (fields.title.includes(value)) score += weight * 3.2;
    if (fields.tags.includes(value)) score += weight * 3;
    if (fields.category.includes(value)) score += weight * 1.4;
    if (fields.summary.includes(value)) score += weight * 1.2;
  });

  return score;
}

function minimumRelevanceScore(queryProfile) {
  if (!queryProfile.terms.length) return 0;

  const strongTerms = queryProfile.terms.filter((term) => term.weight >= 1.5).length;
  if (!strongTerms) return 1.5;
  return Math.max(4, Math.min(22, strongTerms * 3));
}

function normalizeArticle(article) {
  return {
    id: String(article.id || article.url || article.title),
    title: String(article.title || "無題の記事"),
    url: String(article.url || ""),
    date: String(article.date || ""),
    category: categoryById.has(article.category) ? article.category : "blog",
    tags: Array.isArray(article.tags) ? article.tags.map(String).filter(Boolean) : [],
    summary: String(article.summary || ""),
  };
}

function formatDate(value) {
  if (!value) return "日付未登録";
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return dateFormatter.format(date);
}

function getCategoryLabel(id) {
  return categoryById.get(id)?.label || "未分類";
}

function getStats() {
  return categories.map((category) => ({
    ...category,
    count: state.articles.filter((article) => article.category === category.id).length,
  }));
}

function getPopularTags(limit = 12) {
  const counts = new Map();
  state.articles.forEach((article) => {
    article.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

function getFilteredArticles() {
  const queryProfile = buildQueryProfile(state.query);
  const minScore = minimumRelevanceScore(queryProfile);

  const filtered = state.articles
    .map((article) => ({ ...article, relevanceScore: scoreArticle(article, queryProfile) }))
    .filter((article) => {
    if (state.category !== "all" && article.category !== state.category) return false;
    if (state.tag && !article.tags.includes(state.tag)) return false;
    if (!queryProfile.terms.length) return true;
    return article.relevanceScore >= minScore;
  });

  return filtered.sort((a, b) => {
    if (state.sort === "relevance" && queryProfile.terms.length) {
      return b.relevanceScore - a.relevanceScore || b.date.localeCompare(a.date);
    }
    if (state.sort === "title") return a.title.localeCompare(b.title, "ja");
    if (state.sort === "old") return a.date.localeCompare(b.date);
    return b.date.localeCompare(a.date);
  });
}

function renderStats() {
  elements.totalArticles.textContent = state.articles.length.toLocaleString("ja-JP");
  elements.summaryGrid.innerHTML = getStats()
    .map(
      (category) => `
        <div class="mini-stat">
          <strong>${category.count.toLocaleString("ja-JP")}</strong>
          <span>${escapeHtml(category.label)}</span>
        </div>
      `,
    )
    .join("");
}

function renderCategoryControls() {
  const stats = getStats();
  const categoryButtons = [
    { id: "all", label: "すべて", count: state.articles.length },
    ...stats,
  ];
  const tagButtons = getPopularTags();

  elements.categories.innerHTML = `
    <div class="filter-row" role="list" aria-label="カテゴリ">
      ${categoryButtons
        .map(
          (category) => `
            <button
              class="segment ${state.category === category.id ? "active" : ""}"
              type="button"
              data-category="${escapeHtml(category.id)}"
              aria-pressed="${state.category === category.id}"
            >
              <span>${escapeHtml(category.label)}</span>
              <strong>${category.count.toLocaleString("ja-JP")}</strong>
            </button>
          `,
        )
        .join("")}
    </div>
    <div class="filter-row tags-row" role="list" aria-label="よく使われるタグ">
      ${tagButtons
        .map(
          ({ tag, count }) => `
            <button
              class="tag-button ${state.tag === tag ? "active" : ""}"
              type="button"
              data-tag="${escapeHtml(tag)}"
              aria-pressed="${state.tag === tag}"
            >
              #${escapeHtml(tag)}
              <span>${count.toLocaleString("ja-JP")}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderActiveFilter() {
  const labels = [];
  if (state.category !== "all") labels.push(getCategoryLabel(state.category));
  if (state.tag) labels.push(`#${state.tag}`);
  if (state.query.trim()) labels.push(`検索: ${state.query.trim()}`);

  if (!labels.length) {
    elements.activeFilter.hidden = true;
    elements.activeFilter.innerHTML = "";
    return;
  }

  elements.activeFilter.hidden = false;
  elements.activeFilter.innerHTML = `
    <span>${escapeHtml(labels.join(" / "))}</span>
    <button type="button" id="clearFilters">条件をクリア</button>
  `;
}

function articleTemplate(article) {
  const tags = article.tags
    .map(
      (tag) => `
        <button class="inline-tag" type="button" data-tag="${escapeHtml(tag)}">
          #${escapeHtml(tag)}
        </button>
      `,
    )
    .join("");

  const title = escapeHtml(article.title);
  const titleContent = article.url
    ? `<a href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">${title}</a>`
    : title;

  return `
    <article class="article-card">
      <div class="article-meta">
        <span>${escapeHtml(getCategoryLabel(article.category))}</span>
        <time datetime="${escapeHtml(article.date)}">${escapeHtml(formatDate(article.date))}</time>
      </div>
      <h3>${titleContent}</h3>
      <p>${escapeHtml(article.summary || "要約は登録されていません。")}</p>
      <div class="article-footer">
        <div class="tag-list">${tags}</div>
        ${
          article.url
            ? `<a class="read-link" href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">noteで読む</a>`
            : `<span class="read-link muted">リンク未登録</span>`
        }
      </div>
    </article>
  `;
}

function renderArticles() {
  const articles = getFilteredArticles();
  elements.resultCount.textContent = `${articles.length.toLocaleString("ja-JP")}件を表示中`;
  renderActiveFilter();

  if (!articles.length) {
    elements.articleList.innerHTML = `
      <div class="empty-state">
        <h3>条件に合う記事がありません</h3>
        <p>検索語、カテゴリ、タグの条件を少し広げてみてください。</p>
      </div>
    `;
    return;
  }

  elements.articleList.innerHTML = articles.map(articleTemplate).join("");
}

function renderAll() {
  renderStats();
  renderCategoryControls();
  renderArticles();
}

function downloadJson() {
  const payload = JSON.stringify(
    {
      source: PROFILE_URL,
      articleCount: state.articles.length,
      exportedAt: new Date().toISOString(),
      articles: state.articles,
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pharma_note_articles.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function loadArticles() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const articles = Array.isArray(payload) ? payload : payload.articles;
    if (!Array.isArray(articles)) throw new Error("Article array not found");
    state.articles = articles.map(normalizeArticle);
    renderAll();
  } catch (error) {
    elements.resultCount.textContent = "読み込みに失敗しました";
    elements.articleList.innerHTML = `
      <div class="empty-state">
        <h3>記事データを読み込めませんでした</h3>
        <p>ローカルサーバー経由で開いているか確認してください。詳細: ${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderArticles();
});

elements.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderArticles();
});

elements.categories.addEventListener("click", (event) => {
  const categoryButton = event.target.closest("[data-category]");
  const tagButton = event.target.closest("[data-tag]");

  if (categoryButton) {
    state.category = categoryButton.dataset.category;
    renderCategoryControls();
    renderArticles();
  }

  if (tagButton) {
    const nextTag = tagButton.dataset.tag;
    state.tag = state.tag === nextTag ? "" : nextTag;
    renderCategoryControls();
    renderArticles();
  }
});

elements.articleList.addEventListener("click", (event) => {
  const tagButton = event.target.closest("[data-tag]");
  if (!tagButton) return;
  state.tag = tagButton.dataset.tag;
  renderCategoryControls();
  renderArticles();
  document.querySelector("#articles").scrollIntoView({ block: "start" });
});

elements.activeFilter.addEventListener("click", (event) => {
  if (event.target.id !== "clearFilters") return;
  state.query = "";
  state.category = "all";
  state.tag = "";
  elements.searchInput.value = "";
  renderCategoryControls();
  renderArticles();
});

elements.downloadButton.addEventListener("click", downloadJson);

loadArticles();
