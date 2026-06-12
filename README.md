# note記事データベース

濱口貴光（AIとデータサイエンスが好きな薬剤師）の note 記事を検索・閲覧するための静的サイトです。

## 閲覧

GitHub Pages:

https://th-auiwkn.github.io/note/

## 更新

記事データは `data/pharma_note_articles.json` に保存されます。

GitHub Actions が毎日 7:00 JST に自動更新します。手動実行もできます。

```bash
python3 scripts/update-pharma-note-viewer.py
```
