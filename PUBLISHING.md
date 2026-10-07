# Publishing Guide

`booth-outfit-checker` を GitHub で公開するための手順です。

## 1. Public repository を作成

GitHub で次のリポジトリを作成します。

```text
booth-outfit-checker
```

Visibility は **Public** にします。

## 2. このフォルダの内容を配置

```text
booth-outfit-checker/
├─ booth-outfit-checker.user.js
├─ README.md
├─ LICENSE
├─ SUPPORT.md
├─ CHANGELOG.md
├─ PUBLISHING.md
└─ .gitignore
```

## 3. 初回コミット

```bash
git init
git add .
git commit -m "Initial public release v3.4.3"
git branch -M main
git remote add origin <YOUR_REPOSITORY_URL>
git push -u origin main
```

## 4. GitHub の設定

サポートを積極的に行わない場合は、GitHub の

`Settings > General > Features`

から **Issues を無効化**しても構いません。

Issue を開放する場合でも、README と SUPPORT.md に記載した通り、対応保証なしの運用で問題ありません。

## 5. 動作確認

GitHub 上で `booth-outfit-checker.user.js` を開き、`Raw` をクリックします。

Tampermonkey のインストール画面が表示されることを確認してください。

その後、BOOTH の検索ページで次を確認します。

- 気になる登録
- 非表示
- グリッド詰め
- 全表示 / 復元
- 画像プレビュー
- プレビューサイズ変更
- ページ再読み込み後の保存状態

## 6. リリース

GitHub Releases を利用する場合は、タグを Userscript の `@version` と揃えると管理しやすくなります。

例:

```text
v3.4.3
```

## 7. 更新時

Userscript の変更時は必ず `@version` を更新します。

例:

```text
3.4.3 -> 3.4.4
```

その後コミットし、必要に応じて GitHub Release を作成します。

## 将来: 自動更新を有効にする場合

GitHub のユーザー名 / Organization 名が確定したら、Userscript ヘッダーへ `@updateURL` と `@downloadURL` を追加できます。

```javascript
// @updateURL    https://raw.githubusercontent.com/<OWNER>/booth-outfit-checker/main/booth-outfit-checker.user.js
// @downloadURL  https://raw.githubusercontent.com/<OWNER>/booth-outfit-checker/main/booth-outfit-checker.user.js
```

`<OWNER>` を実際の GitHub ユーザー名または Organization 名へ置き換えてください。
