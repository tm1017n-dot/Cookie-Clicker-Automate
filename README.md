# Cookie Clicker Automate

Cookie Clicker Web版をTampermonkeyで自動操作し、短期の購入効率だけでなく、Upgrade解禁、クリック収益、Golden Cookieコンボ、ミニゲーム、Ascensionまで含めて進行を最適化するプロジェクトです。

## 新しいモデルが最初に読む順序

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/HANDOFF.md`](docs/HANDOFF.md)
3. [`docs/REBUILD_SPEC.md`](docs/REBUILD_SPEC.md)
4. [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)
5. [`docs/GAME_KNOWLEDGE.md`](docs/GAME_KNOWLEDGE.md)
6. [`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md)
7. 現行実装 [`src/Cookie_Clicker_Smart_Auto_v8_5_FINAL.txt`](src/Cookie_Clicker_Smart_Auto_v8_5_FINAL.txt)
8. 現行設計書 [`docs/Cookie_Clicker_Smart_Auto_v8_5_ロジック設計書_FINAL.md`](docs/Cookie_Clicker_Smart_Auto_v8_5_ロジック設計書_FINAL.md)

## 現状

現行版はv8.5です。長い改修履歴の中で個別症状への補正が重なっており、次のモデルには現行コードをそのまま延長するより、`REBUILD_SPEC.md`を満たす新エンジンをテスト駆動で組み直すことを推奨します。

最重要の未解決課題は、実画面での購入判断を再現可能な状態スナップショットとして保存し、オフラインで同じ判断を回帰テストできるようにすることです。


