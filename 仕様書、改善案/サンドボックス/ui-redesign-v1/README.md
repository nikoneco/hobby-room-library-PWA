# 趣味部屋図書館 UI試作 v1

「夜の個人書庫」を軸にした、本番非連携のUIプレビューです。

## 分離方針

- 本番の `docs/`、GAS、Service Worker、ハンバーガーメニューは変更しません。
- 現行PWAを同一オリジンのフレームで読み込み、サンドボックス側のCSSと補助JavaScriptだけを適用します。
- 検索などは本番PWAと同じ公開の読み取り専用APIを使用します。
- 書き込みAPIは使用しません。

## 起動

リポジトリ直下でローカルHTTPサーバーを起動します。

```powershell
& 'C:\Users\aqua_\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m http.server 4187 --bind 127.0.0.1
```

次のURLを開きます。

```text
http://127.0.0.1:4187/%E4%BB%95%E6%A7%98%E6%9B%B8%E3%80%81%E6%94%B9%E5%96%84%E6%A1%88/%E3%82%B5%E3%83%B3%E3%83%89%E3%83%9C%E3%83%83%E3%82%AF%E3%82%B9/ui-redesign-v1/
```

## 実装メモ

- 基本フォントは端末内の日本語UIフォントを使用します。
- アイコンは Tabler Icons Webfont 3.34.1 に統一しています。
- アイコンは試作ではCDN配信です。本番採用時は必要なアイコンだけをローカルへ収録します。
- アニメーションはホバー、フォーカス、開閉などの操作フィードバックだけです。
- `prefers-reduced-motion` では移動を停止します。

## デザイン設定

- `DESIGN_VARIANCE: 7`
- `MOTION_INTENSITY: 3`
- `VISUAL_DENSITY: 6`
