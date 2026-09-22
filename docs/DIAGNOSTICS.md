# 診断と実画面検証

## 必須診断スナップショット

次の情報をJSONで出力する。

- スクリプト版、ゲーム版、言語、時刻
- 所持Cookie、表示CpS、非Buff CpS、クリック単価、クリック頻度
- 全施設のID、個数、次価格、実測増産、回収時間
- ストア内全UpgradeのID、内部名、表示名、価格、解禁・購入状態
- Upgradeごとの実測差分、メタデータ推定、説明推定、採用効果、信頼度
- 候補の短期・中期・長期価値
- Target ETAの直接経路と各先行購入経路
- Beam Searchの展開候補と最終計画
- 最終判断を行ったレイヤー
- 購入API結果、購入前後の施設数または`bought`
- 例外とFallback理由

## 切り分け順序

1. Upgradeが`UpgradesInStore`または`UpgradesById`に存在するか。
2. `upgradeAllowed`で除外されていないか。
3. 候補生成後の効果量と回収時間が有限か。
4. 候補集合から分類フラグで消えていないか。
5. ROI frontier、ETA、Beamのどこで順位が変わったか。
6. 選択候補の購入APIが成功したか。
7. 失敗後に別候補へFallbackしていないか。
8. 別インスタンスが購入していないか。

## 単一起動

ページ共通キー`__CC_SMART_AUTO_RUNTIME__`を使う。新版は旧インスタンスの`shutdown()`を呼び、各タイマーはトークン所有を確認する。v8.0以前はこの仕組みがないため、Tampermonkey上で手動無効化が必要。

## 実画面スモークテスト

新規セーブで開始し、各購入前にスナップショットを保存する。最低限、Cursor 1、Upgrade ID 0、Upgrade ID 1、Grandma、Farm、Mine、Factory、各最初のTier Upgradeまで追跡する。期待と異なる最初の周期で停止し、その状態をfixture化する。


