# 引き継ぎ資料

alpha.13（2026-09-25）：状態取得を1周期最大4回のCalculateGainsへ制限し、Upgrade測定を複数周期へ分割。短期3手探索に加えて、次の施設Tier 2段階・Kitten 3段階等を最大512行動の目標経路として比較。自動試験146件。詳細は[分割測定と長期目標](rebuild/BOUNDED_CAPTURE_LONG_GOALS_ALPHA13.md)。ブラウザ検証なし。

alpha.12（2026-09-25）：約60回/秒と1.5秒周期の停止報告に対し、純粋PlannerをWeb Workerへ分離。可視タブの最大2秒の停止は最大5回ずつ補完し、非表示時間は破棄。自動試験143件。詳細は[Planner Worker](rebuild/PLANNER_WORKER_ALPHA12.md)。ブラウザ検証なし。

alpha.11（2026-09-25）：要求・実クリックとも約50回/秒で周期的に停止する報告を、1.5秒周期の反復CalculateGainsがメインスレッドを占有する問題として改善。状態不変時の限界生産測定を再利用し、ロック中施設の測定を省略。自動試験140件。詳細は[状態取得キャッシュ](rebuild/CAPTURE_CACHE_ALPHA11.md)。ブラウザ検証なし。

alpha.10（2026-09-25）：alpha.9実画面で約50回/秒との報告を受け、Game 2.058の20msクリック境界へ5msの余裕を追加。UIに要求回数を表示し、スケジューラー不足とゲーム側拒否を区別可能にした。自動試験137件。詳細は[クリック境界設計](rebuild/CLICK_GATE_ALPHA10.md)。ブラウザ検証なし。

alpha.9（2026-09-25）：10msタイマーが約25msへ間引かれると実クリックが約40回/秒になる問題へ、100ms・最大5回の短時間遅延補償を追加。長時間停止分は破棄し、成功クリックだけを実測へ反映。自動試験135件。詳細は[クリック設計](rebuild/CLICK_SCHEDULER_ALPHA9.md)。ブラウザ検証なし。

alpha.8（2026-09-25）：解禁経路ごとの汎用的な全状態コピーを、書き換え領域だけの専用コピーへ変更。探索設定と判断を維持したまま、合成Planner中央値を次Tier候補で約54%、自然GC込みで約34%短縮。自動試験132件、alpha.7判断30状態の完全一致。詳細は[性能記録](rebuild/PERFORMANCE_ALPHA8.md)。ブラウザ検証なし。

alpha.7（2026-09-24）：短い施設Tier解禁経路が通常探索の枝刈りで最終比較から漏れる問題を改善。一手先・評価期間の重複計算と、資金ETAに不要なGC予測を削減。自動試験130件。詳細・測定範囲は[追加設計](rebuild/STRATEGY_ALPHA7.md)。ブラウザ検証なし。

alpha.6（2026-09-24）：施設相乗効果・Kittenと施設実績の動的生産、自然GCの少数シナリオ評価、Bingo〜Underworld ovensの研究経路を追加。固定購入順なし。GC予測利益は資金ETAに含めない。対応範囲と検証は[追加設計](rebuild/STRATEGY_ALPHA6.md)。One mind以降、特殊GC・ミニゲーム等は未対応。ブラウザ検証なし。

alpha.5：待機理由の誤表示を修正し、未評価・購入対象外の強化を名前で表示。Cookieの定数倍率と価格割引のモデルを追加し、ストア再描画だけの購入処理を許可。状態コピー・探索経路の重複計算を削減。自動試験103件、旧alpha.4との時間イベント比較40状態が合格。性能の範囲・未対応効果は[追加設計と検証](rebuild/PERFORMANCE_ALPHA5.md)を参照。今回の実セーブ診断は未取得、ブラウザ検証なし。

alpha.4：通常施設の次Tier解禁経路、3回の優位確認による予約切替、一手比較に基づく先読み範囲の公平化を実装。詳細・限界・旧版JSON再生方法は[実装記録](rebuild/IMPLEMENTATION.md)と[追加設計](rebuild/STRATEGY_ALPHA4.md)。ブラウザ検証は引き続き明示依頼時のみ。

alpha.3：移動・リサイズ・保存・折りたたみ可能なUI、目標100クリック/秒（1〜100変更可）、実測収益反映と予約解除の競合対策を追加。ユーザー希望により今後のブラウザ検証は明示依頼時のみ。詳細は[実装記録](rebuild/IMPLEMENTATION.md)。

2026-09-23追記：alpha.2で観測予約の持越し・セーブ初期化後の予約残存を修正し、Game測定を軽量化した。報告されたbuilding:8の直接の選択条件は診断未取得のため未確定。[対応内容](rebuild/IMPLEMENTATION.md)を参照。

## 2026-09-23 再構築版の追加

`feat/rebuild-engine` に9.0.0-alpha.1の基本購入エンジン、配布userscript、回帰試験と実測fixtureを追加した。[導入・実装状況・未完了](rebuild/IMPLEMENTATION.md)を最初に確認すること。M5〜M7と全TEST_PLANの完了は未達。以下の旧版分析は背景情報として保持する。

## 1. 目的

Tampermonkey上でCookie Clickerを自動プレイし、単純な最安購入や単発ROIではなく、進行段階に応じた最短成長を実現する。購入、クリック、Golden Cookie、Grimoire、Pantheon、Krumblor、Garden、Stock Market、Research、Season、Grandmapocalypse、Ascensionを最終的に一つの戦略へ統合する。

## 2. ユーザーが重視していること

- 自動購入が止まらないこと。
- Upgradeを不当に低く評価しないこと。
- 最安施設を機械的に買い続けないこと。
- 高価値Upgradeへ貯蓄すると決めたら、資金到達直前に施設を買わないこと。
- 自動クリック収益を正しく含めること。
- 待機上限は固定値ではなく機会費用から決めること。
- 実画面で期待どおり動くこと。机上の簡略モデルだけでは不十分。

## 3. これまで観測された具体的不具合

1. Cursor 1個、Reinforced index finger購入後、Cursorを14個まで購入した。
2. CursorとGrandmaを概ね交互に買った。
3. Child laborを長時間買わなかった。
4. Upgradeを予約しても、資金が貯まった周期に施設を買った。
5. Steel-plated rolling pinsがGrandma 28個でも未購入だった。
6. Carpal tunnel prevention creamがCursor 26個まで未購入だった。
7. 最安施設価格がUpgrade価格を超えるまで、多くのUpgradeを購入しなかった。
8. 改修後も最安施設の購入頻度が高かった。
9. 旧版を複数起動でき、別版の購入タイマーが競合する可能性があった。

## 4. 判明した原因

- Upgrade効果解析が英語説明文へ依存し、日本語表示でクリック・施設倍率を失う経路があった。
- 予約は待機判断にだけ使われ、購入実行失敗時に施設Fallbackへ流れていた。
- 施設2倍Upgradeに固定ETA上限を適用し、貯まる前に同施設を買って目標を遠ざけた。
- 序盤確定手順がUpgrade ID 0だけで終了し、ID 1以降を通常エンジンへ戻した。
- Upgrade目標候補を`priority/critical`で絞り、通常Upgradeを除外した。
- 最終緊急Fallbackが純粋な価格順だった。
- パッチが複数の評価層へ追加され、どの層が最終判断したか分かりにくくなった。

## 5. バージョン経緯

- v7.12: 日本語説明、クリックUpgrade ID相当の既知名、クリック収益評価を強化。
- v7.13: 予約を購入成功まで保持し、失敗時の施設Fallbackを禁止。施設2倍Upgradeを次施設と比較。
- v7.14: 施設2倍Upgradeの等価1施設価格を導入。
- v7.15: 直接貯蓄と先行購入後のTarget ETAを比較する目標コミットメントを導入。
- v8.0: `取得時間 + 回収時間`へ尺度を統一。
- v8.1: 単一起動レジストリと診断スナップショットを追加。
- v8.2: Upgrade ID 0/1/2をクリック基盤系列として扱う。
- v8.3: `priority/critical`必須フィルターを撤廃。
- v8.4: 最上位にUpgrade対施設のROIフロンティアを追加。
- v8.5: 価格順の最終Fallbackを回収時間順へ変更。

## 6. 現行v8.5の構造

- Strategy State Machine
- 候補生成: Building / Upgrade / Unlock chain
- Game状態の仮想変更による増産差分測定
- 複数期間価値評価
- Target ETA / Chain ETA
- Upgrade ROI frontier
- 2～3手Beam Search
- 予約・目標コミットメント
- 排他的購入試行
- ROIベース最終復帰
- 単一起動レジストリ
- UI診断パネル

## 7. 現行実装の問題

現行コードは機能が多い一方、同じ候補をROI、複数期間、戦略補正、ETA、Beam Search、Fallbackがそれぞれ再評価する。局所的な修正が別層で上書きされる危険がある。新実装では、候補の価値情報を一つの構造体へ集約し、最終意思決定者を一つにするべきである。

## 8. 次のモデルが最初に行うこと

1. Game状態スナップショット形式を定義する。
2. 実画面から候補一覧と全中間値をJSON出力する。
3. 報告済み不具合をfixtureとして保存する。
4. Game非依存の純粋な購入プランナーを新規作成する。
5. v8.5からUI操作、Gameアダプター、各ミニゲーム操作だけを段階的に移植する。

## 9. 2026-09-23 詳細設計の追加

実装前の [詳細設計パッケージ](rebuild/README.md) を追加した。次の実装では [DELIVERY](rebuild/DELIVERY.md) のM1から開始する。

- Game/DOM非依存のPlanner、単一Executor、版付きJSON契約を定義。
- 期待資産と資金ETAを分離し、クリック・未回収資産・累計生産を区別。
- 時間イベント、解禁経路、GC/魔法/ミニゲーム/転生の攻略設計を追加。
- [VALIDATION](rebuild/VALIDATION.md) に既存全fixtureと報告9件の対応、追加試験、実画面合格条件を記載。
- 公式main.jsとミニゲーム公開ソースを調査し、出典と取得ハッシュを [STRATEGY](rebuild/STRATEGY.md) に記録。

状態は文書作成のみ。新エンジン、実行可能fixture、schema validator、実画面由来スナップショット、改善ベンチマークは未作成/未実施。報告当時の完全状態はなく、合成fixtureと実画面記録を区別する。旧版の問題が修正済みになったわけではない。

## 10. 既知の設計課題

評価期間・リスク係数・探索上限の調整、仮想状態復元の副作用監査、未知Upgrade、予約の自動再目標化、実行時ゲーム版/Mod対応は未検証。[DELIVERY](rebuild/DELIVERY.md) の確認項目に従い、無根拠の購入Fallbackで回避しない。
