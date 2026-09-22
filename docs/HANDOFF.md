# 引き継ぎ資料

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


