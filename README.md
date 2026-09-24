# Cookie Clicker Automate

再構築版 **9.0.0-alpha.12**: [導入・検証結果・対応範囲](docs/rebuild/IMPLEMENTATION.md) / [配布userscript](dist/Cookie_Clicker_Auto_Rebuild.user.js)。購入・待機・クリック・相乗効果・自然GC予測・初期研究経路・診断再生を実装した段階です。ミニゲーム等を含む全機能の完成版ではありません。

Cookie Clicker Web版をTampermonkeyで自動操作し、短期の購入効率だけでなく、Upgrade解禁、クリック収益、Golden Cookieコンボ、ミニゲーム、Ascensionまで含めて進行を最適化するプロジェクトです。

## 新しいモデルが最初に読む順序

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/HANDOFF.md`](docs/HANDOFF.md)
3. [`docs/REBUILD_SPEC.md`](docs/REBUILD_SPEC.md)
4. [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)
5. [`docs/GAME_KNOWLEDGE.md`](docs/GAME_KNOWLEDGE.md)
6. [`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md)
7. [`docs/NEXT_MODEL_PROMPT.md`](docs/NEXT_MODEL_PROMPT.md)
8. 現行実装 [`src/Cookie_Clicker_Smart_Auto_v8_5_FINAL.txt`](src/Cookie_Clicker_Smart_Auto_v8_5_FINAL.txt)
9. 現行設計書 [`docs/Cookie_Clicker_Smart_Auto_v8_5_ロジック設計書_FINAL.md`](docs/Cookie_Clicker_Smart_Auto_v8_5_ロジック設計書_FINAL.md)

## 現状

現行版はv8.5です。長い改修履歴の中で個別症状への補正が重なっており、次のモデルには現行コードをそのまま延長するより、`REBUILD_SPEC.md`を満たす新エンジンをテスト駆動で組み直すことを推奨します。

最重要の未解決課題は、実画面での購入判断を再現可能な状態スナップショットとして保存し、オフラインで同じ判断を回帰テストできるようにすることです。

## 再構築の詳細設計（実装前）

[詳細設計パッケージ](docs/rebuild/README.md) に、アーキテクチャ、JSONデータ契約、購入・待機Planner、攻略戦略、全fixture対応表、導入計画をまとめています。上記6文書を読んだ後、現行実装へ進む前に確認してください。

文書作成時点では新エンジンの実装・テスト・実画面検証は未実施です。v8.5の旧設計書は履歴資料として扱い、新しい必須要件と矛盾する固定待機上限・購入進行保証・同周期の別購入を継承しません。
