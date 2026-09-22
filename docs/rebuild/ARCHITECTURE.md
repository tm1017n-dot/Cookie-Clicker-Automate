# アーキテクチャ詳細設計

設計版1.0。要件の入口は [設計索引](README.md)。

## 1. モジュールと依存

| モジュール | 入力 → 出力 | 禁止する責務 |
| --- | --- | --- |
| RuntimeCoordinator | 設定・所有トークン・時刻 → 周期開始/停止 | 候補の採用変更 |
| GameAdapter | Game → RawObservation / 単一操作 → ExecutionReceipt | 戦略判断、価格順Fallback |
| EffectModel | 観測・測定結果・Ruleset → EffectEvidence / TransitionModel | 購入優先度の決定 |
| StateBuilder | 観測・設定・予約・能力 → PlannerState | Game参照の持ち越し |
| ActionGenerator | PlannerState・Ruleset → 全候補・不適格理由 | priority/criticalによる除外 |
| Planner | PlannerInput → DecisionRecord | Game、DOM、実時計、グローバル乱数 |
| Executor | Decision・再取得状態・token → Receipt | 別候補への変更、再試行ループ |
| Diagnostics/UI | 保存済みRecord → 表示・JSON | 画面更新時の候補再計算 |

Gameへ触れるのはAdapterのみ。EffectModelが仮想測定を必要とする場合もAdapterの測定結果を受け取る。探索ノードでGameを変更しない。Rulesetは版付きの純粋な数式・遷移規則であり、スナップショットにJavaScript関数を埋め込まない。

将来の配置案は src/core/（純粋計算）、src/game/（Adapter）、src/runtime/、src/ui/、tests/fixtures/、dist/。この設計変更では実装ファイルを追加しない。

## 2. インターフェース契約

- capture(): RawObservation。Game.ready、ゲーム版、読み取り整合性と能力も返す。
- measureEffects(observation, requests): MeasurementBatch。成功/不明/例外/復元失敗を区別。
- buildState(observation, measurements, config, commitment): PlannerState。
- generateActions(state, ruleset): ActionSet。全候補とineligible理由を保持。
- plan(input): DecisionRecord。nextCommitmentと先頭Actionを返し、引数を変更しない。
- execute(decision, runtimeToken): ExecutionReceipt。副作用APIの試行は最大1回。
- replay(snapshot, matchingPlanner, matchingRuleset): ReplayedDecision / VersionMismatch。

型、識別子、金額と時間の単位は [DATA_CONTRACTS](DATA_CONTRACTS.md) を正本とする。

## 3. 1周期の処理

1. 所有token、master、Game.ready、Ascension状態、実行中フラグを確認する。
2. 状態とクリック実績を取得し、仮想測定を同期区間で行い、復元結果を確認する。
3. JSON化できる不変PlannerInputを作り、入力IDとハッシュを確定する。
4. 候補生成、時間遷移、探索、予約判断をPlanner内で完了する。
5. InputとDecisionを履歴へ確保する。記録不能なら購入しない。
6. Executorが所有token、対象状態、価格、所持金、保護額、前提条件を再確認する。
7. waitなら副作用なし。その他は先頭操作を1件だけ呼ぶ。
8. 前後差分を観測しReceiptへ記録する。成功時も失敗時も状態を再取得する。
9. 次の周期へ進む。失敗周期内での別購入、再帰的な購入呼び出しは禁止。

通常周期の初期値は1500ms。解禁・Buff変化・予約資金到達・購入結果で早期再計画を予約できる。ただし同じ周期IDで2回の副作用を起こさない。戦略・手動テスト購入・ミニゲームも同じ書込みキューを使用する。

クリック/GC回収は購入探索とは別の短周期で準備するが、Game書込みと仮想測定には共通ゲートを使用する。GC回収が資金/Buffを変えたら保留中Decisionを無効化する。コンボの操作間隔は実測し、残り時間へ反映する。

## 4. 仮想測定の境界

実際のbuy()/sell()/castSpell()やランダム効果を仮想測定に使わない。対応した施設数・boughtなどを一時変更してCalculateGains等から差分を観測する。

- 操作前に、変更フィールド、再計算の副作用フィールド、関数差替えをJournalへ保存。
- cookies、施設amount/bought、Upgrade状態、実績/解禁状態、Milk、関連カウンタ、再計算フラグ/キャッシュ、Game.Win/Unlock等を対応ゲーム版ごとの監査対象にする。
- try/finallyで全変更を逆順に復元する。再計算で触れる値も復元後に検証する。
- await、setTimeout、UI操作を仮想状態保持中に挟まない。
- 仮想評価で生じた実績・解禁は実ゲームへ適用しない。純粋Rulesetで仮想遷移へ反映する。
- 未監査Mod hook、未知のbuyFunction、復元保証できない効果は実測を行わずunknownとする。
- 測定例外を増産ゼロに変換しない。復元失敗は購入・Game書込みを停止し、reload-required診断を出す。
- 測定後の実測CpSの一致だけで復元成功としない。監査対象状態の一致を検証する。

全GameをJSONコピーできるとは仮定しない。対応版のJournal試験に合格するまでは観測モードを標準とする。

## 5. 成功判定と再検証

施設購入はIDのamount増加、Upgrade購入はbought変化を主要根拠とする。APIの戻り値だけで成功にしない。価格変化、売買モード、bulk設定、外部操作の影響をAdapterで処理する。数量は1に固定し、UIの一括購入設定があっても契約を保つ。

| 結果 | 処理 |
| --- | --- |
| confirmed | Receipt保存。対象取得なら予約完了。新状態から再計画 |
| rejected / exception | 予約保持。追加操作なし。次周期で再計画 |
| pending | 対象差分の観測のみ継続し、解決まで新しい購入を出さない |
| stale | APIを呼ばず破棄。新入力から再計画 |
| invalid-state | 診断付き待機。未監査状態なら手動確認が必要な理由を表示 |

自然クリックによる所持金増加だけは、対象・価格・Buff等が同じで資金条件を満たせば許容する。所持金減少、対象購入済み、価格/Buff/戦略資源変化は再計画する。pendingの観測上限は初期2秒とし、未解決時は停止診断を出す。これは投資待機の上限ではない。

## 6. 単一起動と停止

ページ共通キー __CC_SMART_AUTO_RUNTIME__ を共有する。起動時は旧runtime.shutdown()を呼び、新tokenを登録する。タイマー・キュー・遅延コールバック・Executor直前すべてで所有確認する。shutdownは冪等で、タイマー、イベント、UI、Observer、保留操作を解除する。

v8.1以降との互換試験を必須とする。v8.0以前は共通registryがないため完全な自動停止は保証できない。導入時に旧版を無効化して再読み込みする手順を表示する。

## 7. 設定と操作権限

設定はschemaVersion付き、新キーを用いる。v8.5の重みや固定待機設定を自動流用しない。クリック頻度等の移行可能な値だけを検証付きで移す。

Ascend確定、Sugar Lump消費、セーブリセットは個別の明示許可設定を必要とし、初期OFF。Godzamok用売却、オーラ変更、ローン、季節変更も初期は助言・観測とし、該当機能の検証と有効化後に実行候補へ進む。許可はActionの前提条件として扱い、価値評価から安全性を推測しない。セーブリセットは通常PlannerのActionとして提供しない。

## 8. UI

現在戦略、次Action、予約目標、待機理由、資金到達見込み、受動/クリック/未回収収益、能力不足、実行版・所有状態を表示する。詳細には全候補、除外理由、効果根拠、各期間価値、ETA比較、探索打切りを含める。JSON出力と安全停止を提供し、「買わない理由」が常に追えることを要件とする。
