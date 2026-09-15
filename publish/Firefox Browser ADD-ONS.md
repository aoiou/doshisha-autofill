# アドオンの説明(必須項目のみ)

## 名前（manifest.jsonのnameから補完される）

## 概要（manifest.jsonのdescriptionから補完される）

## 説明

```
同志社大学の認証システム（doshisha.ex-tic.com）におけるログイン操作を自動化する拡張機能です。
ユーザー名の自動入力から「次へ」の自動遷移、パスワードレス（FIDO2）認証の自動開始までを一括で行います。

【主な機能】
- ユーザー名の自動入力
- 「次へ」ボタンの自動クリック（ON/OFF切替可能）
- パスワードレス（FIDO2）認証の自動開始（ON/OFF切替可能）
- 「パスワード」タブの自動選択（ON/OFF切替可能）
- パスワード入力欄への自動フォーカス
- ショートカットキー（Alt+Shift+D / Mac: Option+Shift+D）によるログイン画面起動
- 外観テーマ切替（システム連動 / ライト / ダーク）

【プライバシー・セキュリティ】
ユーザー名および設定情報はブラウザ内のストレージにのみ保存され、外部サーバーへ送信されることはありません。

※本拡張機能は非公式であり、同志社大学とは関係ありません。
```

## Select up to 3 categories for this add-on:

- [x] このアドオンはどのカテゴリーにも当てはまりません

## ライセンス

- [x] MIT License

## ソースコードを提出する必要がありますか？

Mozilla’s add-on reviewers need to be able to read and reproduce the code in your extension. If they can’t, your extension may be rejected.

あなたの拡張機能で以下のいずれかを使っていますか？
    コードジェネレーターまたはミニファイアー
    webpack など、複数のファイルをひとつにまとめるツール
    HTML や CSS 向けのウェブテンプレートエンジン
    コードやファイルに対して何らかの処理を行い、最終的に拡張機能に含めるコードやファイルを生成する、その他何らかのツール

- [ ] はい
- [x] いいえ
