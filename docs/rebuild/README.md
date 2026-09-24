# 再構築・詳細設計パッケージ

解禁経路の状態コピー軽量化は[PERFORMANCE_ALPHA8](PERFORMANCE_ALPHA8.md)を参照。

解禁経路の比較漏れ・重複計算の改善は[STRATEGY_ALPHA7](STRATEGY_ALPHA7.md)を参照。

相乗効果・Kitten・自然GC・研究経路の変更は[STRATEGY_ALPHA6](STRATEGY_ALPHA6.md)を参照。

作成日: 2026-09-23 / 設計版: 1.0 / 状態: 実装前・検証前

実装後の変更は[実装記録](IMPLEMENTATION.md)、購入戦略三点の追加設計は[STRATEGY_ALPHA4](STRATEGY_ALPHA4.md)を参照。予約切替と比較条件はalpha.4追加設計を優先する。

未評価候補・割引モデル・軽量化の変更は[PERFORMANCE_ALPHA5](PERFORMANCE_ALPHA5.md)を参照。

既存要件の確認元: main commit 73a1a59e70e9c4110ce553777b3449ff93b6a945。新規設計の初期パラメータは検証で調整し、変更理由を残す。

## 目的と読み順

v8.5の症状別補正を継承せず、同じ入力で同じ判断を再現できる購入・攻略エンジンを構築する。本パッケージは実装仕様であり、実装完了や攻略効果の実証を示すものではない。

最初に [AGENTS.md](../../AGENTS.md)、[HANDOFF](../HANDOFF.md)、[REBUILD_SPEC](../REBUILD_SPEC.md)、[TEST_PLAN](../TEST_PLAN.md)、[GAME_KNOWLEDGE](../GAME_KNOWLEDGE.md)、[DIAGNOSTICS](../DIAGNOSTICS.md) を全文読む。その後、次の順で読む。

| 文書 | 決めること |
| --- | --- |
| [ARCHITECTURE](ARCHITECTURE.md) | 境界、入出力、実行周期、排他、安全なGame操作 |
| [DATA_CONTRACTS](DATA_CONTRACTS.md) | 不変状態、共通Action、判断・実行ログ、JSONとリプレイ |
| [PLANNER](PLANNER.md) | 経済指標、将来予測、探索、待機、予約、縮退 |
| [STRATEGY](STRATEGY.md) | 攻略ルール、コンボ、ミニゲーム、転生、一次資料 |
| [VALIDATION](VALIDATION.md) | 既存全fixtureとの対応、追加テスト、実画面検証 |
| [DELIVERY](DELIVERY.md) | 実装順、段階別合格条件、配布、設定移行、未検証事項 |

## 正本と競合解決

ユーザーの明示指示、AGENTS.md、REBUILD_SPEC.mdの必須要件を守る。本パッケージは要件を具体化する。新旧文書で矛盾する旧v8.5の固定待機上限・最安購入・購入進行保証・同周期再試行は採用しない。旧設計書は履歴資料である。TEST_PLANの既存ケースを削除せず、数値条件と検証層を補足する。

初期対象はWeb版・通常モード・自動クリックあり。自動クリックなしも正しく評価するが、同じ購入順は保証しない。未対応Mod、未知ゲーム版、Born Againは機能対応状況を明示し、モデルが未対応の操作は診断付きで実行しない。

## 設計決定

- 最終意思決定者はPlannerだけ。ROI、序盤手順、復帰処理に独立した購入権限を与えない。
- クリック収益を総合評価と資金ETAに含める。ただしゲーム固有の通常CpS報酬式へ加算しない。
- 資金・回収可能資産・累計生産・恒久進捗を区別する。
- 待機は正規Action。購入しない周期があることと、エンジンが停止することは区別する。
- 数秒のBuffを長期へ外挿しない。成功確率、反動、解禁、回復までモデル化する。
- 先頭1操作の結果を確認して再計画する。コンボでも確認済み計画の盲目的連続実行はしない。
- 実画面スナップショットは、その周期に使用した入力・中間値を保存する。出力時の再評価は禁止。
- 対応表や効果モデルにはゲーム版と出典を付ける。Wiki推奨値を実行時Gameより優先しない。

## 最初の成果物の範囲

診断JSON、純粋Planner、全既存fixture、Gameモック、単一起動、基本購入・クリック・GC回収のTampermonkey統合を最初の実装単位とする。各ミニゲームは同じ契約で段階的に統合する。未実装機能は能力フラグをfalseとし、仮の有利な評価で購入目標へ誘導しない。

## 完了の意味

文書完成、コード完成、模擬検証合格、実画面合格、攻略改善実証を別々に記録する。現時点は文書作成のみ。実装開始時は [DELIVERY](DELIVERY.md) のM1から進める。
