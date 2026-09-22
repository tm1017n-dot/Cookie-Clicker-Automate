# 次のモデルへ渡す開始プロンプト

以下をそのまま新しいモデルへ渡せます。

---

`tm1017n-dot/Cookie-Clicker-Automate`を読み、Cookie Clicker自動化ツールをゼロベースで再構築してください。

最初に`AGENTS.md`、`docs/HANDOFF.md`、`docs/REBUILD_SPEC.md`、`docs/TEST_PLAN.md`、`docs/GAME_KNOWLEDGE.md`、`docs/DIAGNOSTICS.md`を全文読んでください。現行v8.5は参考実装であり、その構造を無批判に継承しないでください。

最初の成果物は次のとおりです。

1. Game Adapter、Effect Model、Planner、Executorを分離した設計
2. 実画面状態をJSONとして保存できる診断スナップショット
3. スナップショットを入力して購入判断を再生する純粋関数
4. `docs/TEST_PLAN.md`にある全fixtureの自動テスト
5. 施設、Upgrade、待機を共通尺度で比較する新購入プランナー
6. Tampermonkeyで動く統合版

購入価格を効率の代用にしないでください。自動クリック収益を全評価に含め、待機を正式な行動として扱ってください。購入は先頭1手だけ実行し、実状態を再取得して毎回再計画してください。予約購入失敗時に施設へFallbackしてはいけません。

作業前に報告済み不具合をfixtureとして再現し、修正後に同種のUpgradeと施設へ一般化した回帰テストを追加してください。実画面を確認していない場合は、その限界を明示してください。

---


