# 検証仕様・要件対応表

設計版1.0。実装・テスト結果は未取得。この文書は [TEST_PLAN](../TEST_PLAN.md) の全ケースを残したまま条件と追加検証を定義する。

## 1. fixtureの出所と形式

全fixtureに id, provenance（synthetic / captured / reported-reconstruction）, sourceSnapshotId, game/ruleset版, settings, bank, income, buildings, upgrades, buffs, capabilities, commitment, expected, rationale を持たせる。

- synthetic: 単位・数式・候補比較の人工データ。実プレイ再現と呼ばない。
- reported-reconstruction: 報告から再構成したケース。報告時の完全状態は不明と明記。
- captured: 実画面の完全SnapshotBundle。実画面合格判定に必要。
- 期待値はPlanner出力をコピーせず、独立した式・手計算・Game差分から決める。
- 価格や効果の0、負数、nullを区別する。失敗を通すために未知効果を0へ置換しない。

基準クリック条件: requested=measured=20回/秒、Buffなし、hardReserve=0、通常モード、日英で同じID・数値、初期重み/期間規則。ゲーム依存の価格・解禁・基礎効果は対応版から記録する。安定ID未確認のUpgradeは確認してからfixtureを確定し、名前推測のIDを埋めない。

## 2. 既存必須fixtureの対応

| ID | TEST_PLANの条件 | 具体的な入力/検証 |
| --- | --- | --- |
| OPEN-01 | 0 CookieからCursor1 | 基準クリック、新規状態。初期は資金到達wait→Cursor1購入。0資金で購入成功としない |
| OPEN-02 | Cursor1後ID0 | 未購入ID0、基準クリック。直接貯蓄を選び、2個目Cursorで目標を遅らせない |
| OPEN-03 | ID0後ID1 | Cursor1、ID0済、ID1未購入。Cursor追加せず500へ貯蓄 |
| OPEN-04 | Cursor10でID2 | ID0/1済、ID2解禁。クリック効果込みで全候補へ参加し、基準比較で優先評価 |
| LANG-01 | 日本語でも同じ | OPEN-01～04の表示名・説明を日本語/英語へ変更。semantic decisionと実行ID一致 |
| GRAND-10 | Grandma10では次施設優位 | 孤立した効果比較。単体生産g、次価格ceil(100*1.15^10)、Upgrade5000・増産10gの回収比較 |
| GRAND-11 | Grandma11前後で逆転 | 上と同条件でn=11。5000/(11g)とceil(100*1.15^11)/gを比較 |
| GRAND-28 | Grandma28未購入 | 予約なし/あり両方の報告再構成と後のcapturedで、Tier未購入の施設反復を検出 |
| FACT-05 | Factory5直後に即買い固定しない | 孤立比較、次価格ceil(130000*1.15^5)、Upgrade6500000・増産5f。次施設の回収が短い |
| FACT-11 | Factory11前後で逆転 | n=11で同じ式を比較。割引・既存Upgradeを変えた境界移動も検証 |
| VALUE-01 | U500/+50、B400/+2 | bank500、基礎流動10/秒、他効果なし、wait含む候補。先頭Upgrade |
| VALUE-02 | U500/+1、B400/+20 | VALUE-01の増産差のみ変更。先頭施設 |
| VALUE-03 | 安い施設があっても貯蓄 | bank400、基礎流動10/秒、U500/+50、B400/+2。直接U ETA10秒、B経由約41.667秒。Uへ待機 |
| VALUE-04 | priority/critical不要 | VALUE-01/03の両フラグfalse。候補保持と同じ判断 |
| RES-01 | 資金到達周期 | 目標U、bankが目標価格以上。目標APIのみ1回 |
| RES-02 | buy失敗 | 戻り値falseかつ状態不変。0件成功、施設API呼出0、予約保持 |
| RES-03 | 例外 | 目標API例外。施設API呼出0、予約保持、Receiptに例外 |
| RES-04 | ETA短縮だけ先行 | bank100、target1000、income10。先行100/+20ならdirect90秒、via約33.333秒。先行1件と予約保持 |
| RES-05 | ETA悪化は拒否 | RES-04の先行増産を+0.1へ変更。via約99.010秒なのでwait |
| REC-01 | 候補生成失敗から継続 | 純粋生成の1カテゴリ失敗、別カテゴリ有効。診断付き共通Plannerで継続 |
| REC-02 | 復帰を価格順にしない | bank500、基礎流動10、A100/+0.5、B500/+20。回収200秒/25秒。先頭B |
| REC-03 | API例外後の復帰 | 当周期は購入0、次周期に再取得成功後のみ再計画。REC-01と混同しない |

Grandma/Factoryのn=10/11は回収時間の局所境界試験であり、全ストア状態での無条件命令ではない。GRAND-28等の行動試験には他候補・所持金・期間を完全指定する。既存の序盤取得順を固定Opening Bookで強制してテストを通すことは禁止。

## 3. HANDOFFの報告9件との対応

| 報告 | 試験 |
| --- | --- |
| Cursor14まで追加 | OPEN-02/03 + 購入履歴リプレイ |
| Cursor/Grandma交互 | 全体経路の資産/ETA根拠を記録。交互という見た目だけで失敗判定しない |
| Child labor未購入 | FACT-05/11 + 報告状態リプレイ |
| 資金到達で施設購入 | RES-01 |
| Grandma28でTier未購入 | GRAND-28 |
| Cursor26でID1未購入 | OPEN-03をCursor26へ一般化、クリック単価をその状態から測定 |
| 最安価格逆転までUpgrade未購入 | VALUE-01/03、GRAND-28 |
| 最安施設高頻度 | REC-02と目標到達ベンチマーク。購入回数だけで優劣判定しない |
| 旧版競合 | RUN-01～03 |

## 4. 追加テスト

| ID | 入力・操作 | 期待される不変条件 |
| --- | --- | --- |
| ECON-01 | クリックのみ稼働→停止 | 全候補とETAのクリック寄与が0へ更新 |
| ECON-02 | CpS依存mouse強化あり | 施設増産によるmouse増分を含み、二重加算なし |
| ECON-03 | passive100、bank600000 | Lucky基本上限90000。クリック頻度変更で上限不変 |
| ECON-04 | 虫残高あり、bank不足 | 回収Actionなしでは虫残高で購入可能にしない |
| ECON-05 | 市場売却 | bank増加とcookiesEarned=max(bank,cookiesEarned)を個別検証 |
| TIME-01 | 777倍Buff残り1秒 | 1秒後は通常クリックに戻る。900秒間777倍にしない |
| TIME-02 | 研究/解禁が評価期間内 | 完了前に効果を付けず、完了後に候補再生成 |
| TIME-03 | 高回収時間投資のみ | 共通期間延長で有益な投資を永久先送りしない |
| TIME-04 | 購入時刻がHより後 | H内の費用・増産を計上しない。待機中収益は計上 |
| MODEL-01 | boughtだけでは効果不明 | 未知候補保持、実測ゼロと区別、架空増産なし |
| MODEL-02 | Kitten/実績/施設節目 | 前提達成後にMilk/価格/候補更新、子状態へ根差分を流用しない |
| MODEL-03 | 表示文だけ異なる | IDとメタデータが同じなら同じ効果・判断 |
| COMBO-01 | FtHoF、GC0/1/2枚 | 失敗率が公式規則に従い変化 |
| COMBO-02 | Dragonflight中 | FtHoF成功分岐にClick Frenzyを含めない |
| COMBO-03 | 塔数/level/魔力を変更 | 費用と非線形回復を再計算。常に塔追加有利としない |
| COMBO-04 | Godzamok売却 | CpS/Synergy損、買戻費、残り時間を控除 |
| FARM-01 | 成熟前/後、低bank/高bank | 収穫条件と所持金/CpS上限を守る |
| LOAN-01 | 反動がHより後 | 未払コストを残し、反動無視の有利判定をしない |
| ASC-01 | 今転生/次パッケージ | 前提/費用/復帰時間の根拠。許可なしでは実行しない |
| SAFE-01 | 測定中例外を各段階へ注入 | Journalの全監査フィールド復元、当周期購入0 |
| SAFE-02 | 復元不能 | 全書込み停止、reload-requiredを表示 |
| SAFE-03 | API trueでも数/bought不変 | 成功にしない。pendingの間に別操作なし |
| SAFE-04 | 判断後価格/Buff/資源変更 | staleで実行0、新入力から再計画 |
| RUN-01 | 新版を2回注入 | 最終tokenだけが書込可能。タイマーとUIの重複なし |
| RUN-02 | v8.1～8.5と新版 | 両注入順で旧tokenの遅延callbackも書込不可 |
| RUN-03 | v8.0以前あり | 自動停止保証不可を表示。無効化/再読込手順がある |
| REPLAY-01 | 同じbundleを100回再生 | Decision・予約・展開経路・数値が許容差内で一致 |
| REPLAY-02 | 未知schema/ruleset | 閲覧のみ、再生成功を装わない |
| REPLAY-03 | node上限/unknown子状態 | 打切り理由が明示され、価格順へ復帰しない |
| LOG-01 | JSON出力前後を観測 | Game再測定/API呼出なし、出力と購入時入力が一致 |
| LOG-02 | quota超過 | 検証運転停止、保存範囲と未保存が明示 |

一般化試験では施設種、個数、価格割引、増産、クリック頻度をパラメータ化する。優位関係の逆転を含め、特定Upgrade名だけ通る実装を検出する。

## 5. 検証層と合格条件

1. 構文/静的境界: 配布userscriptの構文、coreからGame/DOMへの依存がない。
2. 純粋単体: 全既存fixtureとECON/TIME/MODEL/REPLAYが合格。
3. Gameモック統合: API失敗・例外・復元・pending・stale・数量1・再計画が合格。
4. Snapshot replay: capturedとreported-reconstructionを分離し、全保存状態で一致。
5. 実ブラウザ: 以下の新規状態スモーク、日英、旧版共存が合格。
6. 戦略追加: COMBO/FARM/LOAN/ASCは該当機能の有効化前に合格。未実装による未実施を合格扱いしない。

## 6. 実画面スモーク

専用の新規セーブ環境を使い、既存ユーザーセーブを上書きしない。ゲーム版、ブラウザ、Tampermonkey版、Mod、表示言語、クリック実績、初期セーブ識別子を記録する。

0 Cookie→Cursor1→ID0→ID1→Grandma/Farm/Mine/Factoryと各最初のTierまで、購入前bundleと購入後Receiptを保存する。期間中の全購入を追跡するが、Farm以降の厳密な取得順は経済条件で決める。期待と違う最初の周期で停止しfixture化する。

日英は同じ初期状態と設定で比較する。自然GC乱数の違いを言語差と誤判定せず、同じ入力JSONの意味的判断一致と実画面のID/価格/効果観測を別々に確認する。実画面未実施ならリリース報告へ明記する。

## 7. 攻略ベンチマーク

比較対象: v8.5、単純最安、単発回収時間、新Planner。最安等は比較用だけで本番Fallbackへ入れない。

- 合成シナリオ: 序盤クリック、Tier貯蓄、研究/Kitten解禁、Buff終了、コンボ準備、転生前。
- 確率シナリオ: seed 0～99の100通り、同じ初期状態・同じランダムstreamを各方式へ適用。
- 指標: 目標到達時間p50/p90、時間予算内到達率、最終資産、累計生産、操作失敗数、無根拠待機、計算時間。
- 目標: ID1、Factory/Tier、対応コンボ準備、指定Heavenlyパッケージ。各シナリオに目標IDと時間予算を事前登録。
- 初期の退行基準: 決定的ケースの必須期待値は全件合格。確率ケースはp50/p90がv8.5比5%超悪化または到達率5ポイント超低下なら要調査。これらは品質ゲートの設計値であり、実証済み性能ではない。
- 改善主張はケース別差分と95%信頼区間を伴う。未達を除外して平均を良く見せない。
- 期間0.5/1/2倍、クリック0/5/20回、探索予算0.5/1/2倍の感度試験を行う。
- 模擬勝利だけで実ゲームの最短攻略を達成したとは書かない。

## 8. 結果の保存

各段階の結果表に commit, fixture版, seed, 実行環境, pass/fail/not-run, diagnostics path, known limitations を保存する。実装前の本変更ではテストを実行したという結果を作成しない。
