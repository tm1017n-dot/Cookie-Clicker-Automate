# 攻略戦略・ゲームモデル詳細設計

設計版1.0。調査日2026-09-23。公式公開ソースを一次資料、指定日本語Wikiを攻略上の参考資料とする。ここでの設計案は実プレイで優位性を実証済みではない。

## 1. 出典の優先順位と版管理

実行時Gameの対応版データ・価格関数 → 対応版の公式実装 → Wikiの記述。Wikiはページごとに対応版が異なるため、トップページの版を全記事へ適用しない。ゲーム起動時にGame.versionを記録し、取得ソースのハッシュとRuleset対応版を照合する。

| 資料 | 確認箇所 | 取得ファイルSHA-256 |
| --- | --- | --- |
| [main.js](https://orteil.dashnet.org/cookieclicker/main.js) | mouseCps, Lucky, Wrinklers, Milk, Sugar baking, prestige | D530A13B6A63034461BB5DB25D5C7225BDA57D03E49EE24C528E72FF13994FA0 |
| [Grimoire](https://orteil.dashnet.org/cookieclicker/minigameGrimoire.js) | computeMagicM, getSpellCost, getFailChance, FtHoF, logic | 469382386F157C0BD3B1C85F3068E20B68F61F432B73756B7DC60DA091A34EC6 |
| [Garden](https://orteil.dashnet.org/cookieclicker/minigameGarden.js) | getCost, onHarvest, freeze, 成長 | DCDB8CF6A91B7BD4810ECDD81E7877649B341E98897782383798878C01918A7C |
| [Market](https://orteil.dashnet.org/cookieclicker/minigameMarket.js) | buyGood, sellGood, loanTypes, rawHighestCps | 9D60751475062EFC023E776280A0DAAD7418B369BD7F412F8F3B1CDA8ECA7C4E |
| [Pantheon](https://orteil.dashnet.org/cookieclicker/minigamePantheon.js) | gods, slots, swaps | 2E7B9CFDAF847CC51F0D42ED06943462111F88CB779BC6F62645E1E632431867 |

ファイル全体をリポジトリへ転載せず、式と確認箇所を記録する。将来URLの内容が更新されたら再監査する。ハッシュは今回取得物の識別であり、実ブラウザで同一版が稼働した証拠ではない。

## 2. クリック・施設・Upgrade

【確認済み】mouseCpsは非Cursor施設数に依存する加算、通常CpS割合の加算、クリック倍率等を合成する。したがって施設購入・Kitten・Synergyでもクリック収益が変わりうる。

【設計】すべての候補で受動とmouseCpsの両方を再評価する。実クリック頻度は成功クリック数/観測秒で推定し、設定頻度とは別に記録する。初期観測窓5秒、起動直後は設定値を低信頼の暫定値として使用。バックグラウンド復帰・設定変更・停止時は推定を更新し、停止時は即0にする。

Cursor ID0/1/2の取得順は基準fixtureで検証するが、クリック無効・特殊Buff・価格補正が違う状態へ無条件適用しない。施設Tierの優劣逆転も回収時間境界と最終購入判断を区別する。

## 3. Golden Cookieと資金保護

【確認済み】Luckyは通常CpSと所持金による上限を持つ。基本上限は min(0.15*bank,900*Game.cookiesPs)。公式式の報酬補正と加算13も別途適用する。クリック収益はこのCpSへ足さない。通常の上限到達資金は6000*その時点のCpSとなる。

【設計】bank保護はhardReserve（明示設定）とsoftReserve（期待報酬から生じる戦略目標）を分ける。序盤から機械的にFrenzy Lucky用資金を全額保護しない。購入の生産増加と、資金減少による次回報酬の期待損失を比較する。softReserveは評価効果であり、別の購入拒否レイヤーにしない。

GC頻度Upgradeは単なるCpS増産ゼロではない。発生間隔と効果持続から重複機会を評価する。期待GC収益をE(t)に入れたなら、同じコンボ利益をcomboValueへ重ねない。自然GCと召喚GCを別モデルにする。

参考: [GC](https://w.atwiki.jp/cookieclickerjpn/pages/15.html)。「初期から最大貯蓄」等の固定攻略手順は採用しない。

## 4. Grimoireとコンボ

【確認済み】
- 最大魔力はWizard Tower数とlevelの非線形式、呪文費用は最大魔力割合を含む。
- 魔力回復は残量依存。毎秒一定回復でETAを出さない。
- FtHoFは画面上GC数によって失敗率が増え、自然GCと抽選が異なる。
- Dragonflight中は成功側候補へClick Frenzyを追加しない。

【設計】自然Buff取得→詠唱→生成GC回収→必要なら売却/収穫、という前提と期限を持つ計画を作る。FtHoFの未来結果は既知と扱わず、固定seedの模擬シナリオで分布を比較する。失敗後の再詠唱機会費用も含める。

dualcastは塔の売却・残魔力・費用の再計算・買い戻し・操作時間を含む。塔数の増加を常に魔法性能向上とみなさない。コンボ中も1操作→確認→再計画を短周期で行う。通常購入が売却や魔法の間へ割り込まないよう、同じPlannerがコンボ前提を制約として保持する。

参考: [Grimoire](https://w.atwiki.jp/cookieclickerjpn/pages/89.html)。

## 5. Pantheon・Dragon

【設計】Godzamokのクリック利益から売却損、CpS低下、Synergy/指系加算の低下、買い戻し費用を差し引く。安い施設を常に売る規則にしない。Building Specialが有効な施設、ミニゲーム資源維持に必要な塔等は売却後状態を再評価する。

聖霊の交換はswapsと回復時間、GC捕獲との相性を含める。HoloboreとGC自動捕獲など競合する方針を同時に有効な最適戦略として評価しない。

Dragonは訓練・オーラ切替時の犠牲施設と回復費用を持つActionとする。クリック/生産/虫回収/コンボ用オーラは状態で価値が変わる。オーラ組合せ、DragonflightとFtHoFの相性を対応版で検証するまで自動切替を有効にしない。

参考: [Pantheon](https://w.atwiki.jp/cookieclickerjpn/pages/88.html)。オーラ操作APIの副作用監査は実装前に追加確認が必要。

## 6. Wrinklers・Research・Grandmapocalypse

【確認済み】虫の蓄積は表示上の減産と単純に相殺できない集団効果を持ち、回収倍率も状態に依存する。

【設計】保持、必要数のみ回収、全回収を比較する。購入や転生目標への資金不足を埋めるための回収と、将来の虫収益・再出現待ちの損失を比較する。Shinyは初期保護。現在所持金と未回収残高を分け、同一残高を資金と資産へ二重計上しない。

研究は今のCpSだけでなく後続研究の解禁と完了時間を扱う。Grandmapocalypse進行、Pledge等はWrath分布・虫収益・コンボ機会と支払費用を比較する。Researchを「常に買う」「常に禁止」する固定方針は避けるが、操作許可がなければ助言にとどめる。

参考: [Grandmapocalypse](https://w.atwiki.jp/cookieclickerjpn/pages/19.html)。

## 7. Garden・Season

【確認済み】作付費用はCpS依存部分と最低価格を持つ。Bakeberry/Queenbeet等は成熟時に所持金とCpSで制限される報酬を持つ。

【設計】作付、成熟待ち、凍結、収穫、種解禁を経路化する。作付費用が高いBuff中と収穫報酬が高いBuff中を区別する。株ごとの成長・枯死・隣接条件を考慮し、全株が同時に必ず成熟する前提を置かない。連続収穫は1株ごとの資金増加と効果変化を反映する。

季節は切替費用、残りドロップ、Santa等の解禁経路、Research/コンボとの資源競合を評価する。未取得アイテム数だけで季節を巡回しない。ドロップ期待価値には未取得状態と確率を含める。

参考: [Garden](https://w.atwiki.jp/cookieclickerjpn/pages/73.html)。季節ごとの確率・操作副作用の詳細監査は対応段階で行う。

## 8. Market・Loan

【確認済み】売買換算はrawHighestCpsを使い、購入側にはoverheadがある。売却は通常のGame.Earnを使わず、bank加算後にcookiesEarned=max(bank,cookiesEarned)とする。売却利益を全額通常生産と同一視しない。

【設計】株価の安さだけでなく売買コスト、資金拘束、購入/コンボの機会費用を評価する。単なる価格上昇予測を確定利益にしない。ローンは頭金・利益期間・反動期間・予定転生まで含める。短い評価期間の外に反動を隠さない。資産増加と名声進捗を別々に表示する。

参考: [Market](https://w.atwiki.jp/cookieclickerjpn/pages/79.html)。

## 9. Sugar Lump・Ascension

【確認済み】Sugar bakingは未使用Lump数（上限あり）で生産を増やす。Lump消費はミニゲーム解禁/拡張以外に現在生産への機会費用もある。

【設計】LumpはCookieへ固定換算しない。希少資源として解禁DAGと将来価値を保持する。消費は個別許可設定の対象。

転生は所持Heavenly Upgrade、前提関係、利用可能chipsを基に購入パッケージを列挙する。今転生・次パッケージまで継続を、復帰時間と次目標到達時間で比較する。固定PL列だけで確定しない。虫回収・株換金等の終了処理は個別経路として記録し、累計生産への寄与を実際の規則で計算する。初版は助言のみ。

参考: [Legacy](https://w.atwiki.jp/cookieclickerjpn/pages/53.html)。

## 10. 戦略の評価方法

各提案は同一初期状態、同一シナリオseed、同一クリック条件で比較する。単発の最大収益より目標到達時間の中央値・下位成績・未達率を重視する。平均のみの改善で大幅な失敗増加を隠さない。条件と評価値は [VALIDATION](VALIDATION.md) に従って保存する。
