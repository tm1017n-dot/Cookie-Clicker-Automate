# ゼロベース再構築仕様

## 1. レイヤー

### Game Adapter

Cookie Clickerの`Game`オブジェクトだけを扱う。状態取得、価格取得、購入、クリック、仮想状態の保存復元を担当する。戦略判断を含めない。

### Effect Model

各行動の効果を`deltaLiquidCps`、`deltaEconomicCps`、`deltaClickCps`、`unlockEffects`、`comboEffects`、`confidence`へ正規化する。優先順位を決めない。

### Planner State

所持Cookie、保護額、施設数、Upgrade、実績、Milk、Buff、季節、ミニゲーム、クリック速度、現在戦略状態を含む不変データ。

### Action Generator

施設1個、Upgrade、待機、必要な解禁購入、コンボ準備を列挙する。候補を分類フラグで削除しない。

### Planner

一定期間後の期待資産と重要目標到達時間を比較する純粋関数。GameやDOMを直接参照しない。

### Executor

Plannerが返した先頭1行動だけを実行し、成功を確認する。失敗時は同周期に別候補を買わず、状態を再取得して再計画する。

## 2. 共通候補形式

```js
{
  id,
  kind,                 // building | upgrade | wait | unlock | combo
  targetId,
  price,
  affordable,
  waitSeconds,
  deltaLiquidCps,
  deltaEconomicCps,
  deltaClickCps,
  paybackSeconds,
  unlockValue,
  comboValue,
  confidence,
  sourceEvidence,
  simulationWarnings
}
```

## 3. 判断原則

- 価格ではなく購入後の期待資産で比較する。
- 待機も同じActionとして比較する。
- クリック収益は`mouseCps × 実クリック頻度`として全経路へ含める。
- 直接貯蓄と先行購入後の目標ETAを比較する。
- 一度に実行するのは1行動だけ。
- 2～3手探索後も先頭1手だけ実行し、再計画する。
- 効果不明Upgradeは捨てず、信頼度の低い候補として保持する。
- 施設Tier、Kitten、Synergy、Research等の解禁価値を明示的に持つ。
- コンボ準備中は流動性とクリック倍率の価値を上げる。

## 4. 価値関数

最低限、複数期間で次を評価する。

```text
wealth(H) = cookies_after_action + effective_income_after_action * (H - wait)
           + unlock_value + combo_value - risk_penalty
```

短期・中期・長期を別々に保持し、早い段階で重み付き1値へ潰さない。Pareto frontierを作り、戦略状態が最後に重みを選ぶ。

## 5. Upgrade評価

優先順位は以下の証拠を統合する。

1. 仮想購入前後のGame実測差分
2. 内部IDと`buildingTie`、`tier`、`power`等のメタデータ
3. 英語・日本語説明文
4. 既知のゲームルール表
5. 効果不明時の保守的評価

名称だけの例外は最終手段とし、安定IDがある場合はIDを使う。

## 6. 予約・コミットメント

予約は固定時間上限で開始・終了しない。次を毎周期比較する。

- 目標へ直接貯蓄するETA
- 各購入を1件行ってから目標へ貯蓄するETA

先行購入がETAを短縮する場合だけ許可する。目標購入が失敗した場合は予約を保持し、施設Fallbackは禁止する。

## 7. 安全性

- 単一起動トークンを必須とする。
- 仮想状態は必ず`finally`で復元する。
- Game API例外時は購入せず診断を残す。
- 購入成功は施設数または`bought`変化で確認する。
- セーブ破壊、Ascend自動確定、Sugar Lump不可逆操作は別承認設定にする。

## 8. 詳細設計と用語の具体化

[詳細設計索引](rebuild/README.md) を本仕様の実装契約として参照する。

- 価値関数のcookies_after_actionには、購入前の待機中に得た収益と購入費を反映する。実装では [PLANNER](rebuild/PLANNER.md) の時間イベントごとの積分を使う。
- deltaLiquidCpsは受動の流動収益差とクリック収益差の合計、deltaEconomicCpsはそれに未回収資産増加率差を加えた値。deltaClickCpsは内訳であり、再度加算しない。
- クリック込みの総合評価と、Lucky等のゲーム固有通常CpS式を区別する。
- unlockValue/comboValueは計上済み報酬と重複しない残存価値のみ。
- 固定期間で長期投資を永久に拒否しないよう、候補共通の期間延長規則を用いる。これは固定待機上限ではない。
- 候補生成の局所失敗、探索予算超過、Game API例外を区別する。Game API例外周期には購入しない。
- 未対応ミニゲーム操作は能力不足を明示し、助言/観測から段階導入する。
