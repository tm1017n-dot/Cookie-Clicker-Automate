# データ契約・診断・リプレイ設計

設計版1.0。関連: [ARCHITECTURE](ARCHITECTURE.md)、[PLANNER](PLANNER.md)。

## 1. 共通規約

- 時間は秒、金額はCookie、率はCookie/秒。Gameのframeはcapture時のfpsで秒へ変換する。
- Gameの内部数値と同じIEEE-754 Numberを初期採用する。有限値のみJSON numberとする。
- 不明/到達不能は { status: "unknown" | "unreachable", value: null, reason }、既知は { status: "known", value: number } とする。NaN/Infinityをnullへ黙って変換しない。
- 価格はGameの価格関数による値。表示丸め値、翻訳済み名前、15%固定近似を実ゲーム価格の正本にしない。
- 比較許容差 eps(a,b)=max(1e-9,1e-12*max(abs(a),abs(b)))。時間差の判定には max(1/fps,eps(a,b)) を使う。異常な巨大値/非有限値は診断し、購入へ進めない。
- 安定IDは building:<numericId>、upgrade:<numericId>、spell:<parentId>:<spellId> 等。Action IDはkind・target・数量・目標経路IDから決定的に生成。
- 入力はdeep immutable。参照・関数・DOM・Gameオブジェクトを含めない。
- キーを辞書順、集合を安定ID順に正規化したUTF-8 JSONをSHA-256で識別する。表示名、収集時刻等を含む完全入力ハッシュと、意思決定に使う値だけのsemanticHashを分ける。

## 2. PlannerInput

| フィールド | 内容 |
| --- | --- |
| schemaVersion | 初版1。未知majorはリプレイ拒否、暗黙移行禁止 |
| snapshotId / cycleId | 周期と保存記録を結ぶID |
| engineVersion / rulesetVersion / rulesetHash | 実行・再生に必要な計算仕様 |
| environment | scriptVersion, gameVersion, language, fps, observedAt, mod一覧 |
| config | 評価期間、重み、探索上限、クリック設定、操作許可の完全値 |
| capabilities | read/measure/execute可否を機能別に記録し、不可理由を持つ |
| state | 下記PlannerState |
| evidence | 候補の実測・メタデータ・説明推定・採用効果 |
| transitionModel | 対応版の係数・価格/解禁条件・時間イベント情報 |
| stochasticModel | シナリオ方式、seed、サンプル数、抽選モデル版 |

observedAtは表示用。Plannerが使う相対時間はstate.elapsedSecondsから計算する。Date.now()をPlanner内で呼ばない。

## 3. PlannerState

| グループ | 必須情報 |
| --- | --- |
| economy | bank, hardReserve, softReserveTargets, displayedCps, unbuffedCps, passiveLiquidCps, clickUnit, clickRate, clickIncome, deferredGrowthCps |
| progress | cookiesEarned, cookiesReset, prestige, chips, resets, strategy, strategyReason |
| clicking | requestedRate, measuredRate, observationSeconds, successfulClicks, visibility, confidence |
| buildings[] | id, amount, bought, level, free, unlocked, nextPrice, priceModifiers, totalCps, metadata |
| upgrades[] | id, internalName, displayName, pool, inStore, unlocked, bought, price, metadata, effectStatus |
| achievements | stable IDs, owned, countedForMilk, milkProgress |
| buffs[] | id/type, remainingSeconds, passiveMultiplier, clickMultiplier, priceMultiplier, source |
| unlocks | 前提条件DAG、達成状態、次の節目、研究対象・残り時間 |
| minigames | unlocked/loaded/levelと下記資源。未取得と未ロードを区別 |
| commitment | 目標、状態、開始周期、直接/先行ETA、前回結果 |
| pendingExecution | 未確定操作IDと観測状態。なければnull |

ミニゲーム資源:
- Grimoire: magic, maxMagic, spellsとcost/failure parameters, cooldown, castCount。
- Pantheon: slotsの内部ID、swaps、次回回復、時間依存効果の位相。
- Dragon: level, auras, 解禁条件、変更/訓練の犠牲施設。
- Garden: plotsの種・age/mature、soil、freeze、次tick、種解禁、成長/死亡分布。
- Market: goodsのstock/quote、broker/overhead、office、loansと利息残時間、rawHighestCps。
- Wrinklers: 個体ID・phase・type・sucked・回収倍率、発生条件。
- Season/Research: season、残時間、切替回数/価格、収集済みID、研究状態。

初期版で使わない項目もcapabilitiesと観測可否を持つ。欠落をゼロで補って利用可能とみなさない。

## 4. EffectEvidence

候補ごとに measured / metadataEstimate / descriptionEstimate / rulesetEstimate / adopted を別々に保存する。

各証拠は source, sourceVersion, method, status, passiveLiquidDelta, clickDelta, deferredDelta, confidence（high/medium/low/unknown）, coverage, warnings を持つ。数値の最大値を採用する方式は禁止。正常かつ対象効果を覆う測定を優先し、不足分だけ独立した根拠で補う。同じ倍率の二重加算は禁止する。

confidenceは成功確率ではない。数値的確率が必要な場合は別のoutcomeProbabilityを使う。bought切替だけではbuyFunctionの一回効果・研究開始・解禁を測れないことをcoverageで表す。

未知効果は有効なUpgrade候補として保持する。価格不正や操作権限なしは別のeligibility理由を付ける。モデル下限と上限が不明ならunknownを保ち、勝手な正の増産を付けない。

## 5. Action / ActionEvaluation

REBUILD_SPECの共通フィールドを保持し、以下を追加する。

| 項目 | 契約 |
| --- | --- |
| kind | building / upgrade / wait / unlock / combo |
| operation | buyBuilding, buyUpgrade, waitUntil, castSpell, sellBuilding, harvest, popWrinkler, switchSeason等の実操作 |
| targetId / quantity | 安定ID。通常施設購入は1 |
| goalId / planStepId | 解禁・コンボ経路との関係 |
| price | 今の先頭操作に必要な額。経路総費用はpathCostとして分離 |
| affordable / eligibility | 資金条件と能力/設定/状態条件を分離 |
| waitSeconds / waitUntil | 次イベントの時間と種類、待機対象ID |
| deltaLiquidCps | 受動流動収益差＋クリック収益差 |
| deltaClickCps | 上記に含まれるクリック寄与。別途足さない |
| deltaEconomicCps | deltaLiquidCps＋未回収資産増加率差 |
| paybackSeconds | price/正のdeltaEconomicCpsによる参考値。時間依存では区間モデルと併記 |
| unlockValue / comboValue | 未計上の終端価値のみ。Cookie単位、根拠と有効期限を必須化 |
| confidence / sourceEvidence / simulationWarnings | 証拠参照 |
| horizons[] | horizonSeconds, liquidWealth, realizableWealth, earnedProgress, residualValue, riskPenalty, objectiveValue |
| targetEta | direct、各via購入経路、短縮量、未到達理由 |
| outcomes | 各確率分岐の資源変化・時間・重み |
| preconditions / invalidators | 実行直前検査と再計画条件 |

unlock/comboは高水準の経路ラベルで、Executorが丸ごと実行してはいけない。Plannerが先頭のprimitive operationへ具体化する。不可逆操作も同じ契約で許可設定を確認する。

## 6. DecisionRecord

inputHash, semanticHash, decisionId, cycleId, finalLayer="planner", strategyWeights, horizons, allCandidates, frontier, expandedNodes, prunedReasons, objectiveComponents, selectedAction, plannedSteps, nextCommitment, reasonCode, reasonParameters, warnings を必須とする。

reasonCode例: BUY_BEST_PLAN / WAIT_TARGET / BUY_ADVANCES_TARGET / WAIT_EVENT / WAIT_UNKNOWN_EFFECT / WAIT_INVALID_STATE / RETRY_TARGET_NEXT_CYCLE。日本語文はreasonParametersからUIで作る。順位付けに表示文を使わない。

探索途中の安定nodeId、parentId、Action ID、資産値、ETA、剪定理由を保存する。全候補一覧から表示上位件以外を削除しない。未展開の候補は「劣位」と呼ばずbudget-prunedとする。

## 7. ExecutionReceipt

decisionId, actionId, runtimeToken, attemptCount（0/1）, start/end, API戻り値の安全な要約, before, after, status, exception, replanReason。

before/afterは施設数、bought、資金、対象ミニゲーム資源等、成功判定に必要な値。例外stackからローカルパス等は出力時に除去できる。生のセーブ文字列、認証情報、DOM全体は保存しない。

## 8. JSON出力と再生範囲

SnapshotBundle = PlannerInput + DecisionRecord + ExecutionReceipt（未実行はnull）+ captureStatus + checksums。

リプレイは2種類:
1. decision replay: 保存した観測・効果・遷移入力から同じ版の純粋Plannerを動かし、selectedAction・予約・値・探索経路を照合する。
2. model replay: 生の観測と固定版Rulesetから効果モデルも再計算する。実Gameへの仮想測定が必須な部分は記録済み測定を証拠として使用し、再測定したと偽らない。

根の増産差分を全子ノードへ固定適用しない。対応した非線形効果はRulesetから再計算し、根の測定値との残差を記録する。未対応な子状態はmodel-unknownで枝を止める。完全なゲーム再現/乱数未来予知をJSON再生の要件にはしない。

移行時は元schemaと元bundleを保存する。計算版がない場合は閲覧のみ許可してVersionMismatchを返す。

## 9. 保存と容量

メモリには直近100周期の完全記録を初期上限として保持する。実画面検証では購入前の全記録をIndexedDBへ逐次保存し、まとめてエクスポートする。容量・quota失敗時は検証運転を停止して保存済み範囲を明示する。切り詰めた記録をreplay-completeと表示しない。記録数上限は投資待機上限とは無関係。
