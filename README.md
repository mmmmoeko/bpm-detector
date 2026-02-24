# BPM Detector

ブラウザだけで動作する BPM（テンポ）検出 Web アプリです。
音声ファイルをドラッグ&ドロップするだけで、楽曲の BPM を自動解析します。

**デモ:** https://mmmmoeko.github.io/bpm-detector/

## 概要

MP3 / WAV ファイルを読み込み、Web Audio API による音声解析と複数のアルゴリズムを組み合わせて BPM を推定します。波形とオンセット検出結果のビジュアライズ、ブラウザ上での音声再生にも対応しています。

## 使い方

1. [アプリを開く](https://mmmmoeko.github.io/bpm-detector/)
2. 解析したい音声ファイルをドロップゾーンにドラッグ&ドロップ（またはクリックしてファイルを選択）
3. 自動的に解析が始まり、BPM と信頼度が表示されます
4. 波形・オンセット検出のビジュアライズを確認できます
5. 再生ボタンで音声を試聴できます

### テスト用クリック音の生成

[テストクリック生成ページ](https://mmmmoeko.github.io/bpm-detector/generate-test-clicks.html) では、任意の BPM のクリック音 WAV ファイルを生成・ダウンロードできます。検出精度の検証にご利用ください。

- プリセット: 60 / 80 / 100 / 120 / 128 / 140 / 150 / 170 BPM
- カスタム BPM（30〜300、0.1 刻み）
- 音色: クリック / キック風 / サイン波
- 長さ: 3〜60 秒

## プライバシー・セキュリティ

**音声データは一切外部に送信されません。**

- すべての音声処理はブラウザ内（クライアントサイド）で完結しています
- `fetch`、`XMLHttpRequest`、`WebSocket` 等の外部通信 API は一切使用していません
- 外部 CDN やサードパーティスクリプトの読み込みもありません
- Cookie、localStorage 等のストレージも使用していません
- 未発表音源やレコーディング中のデモなど、機密性の高いファイルも安全に解析できます

ソースコードは本リポジトリで全て公開されており、上記の安全性を誰でも検証できます。

## 対応ファイル形式

| 形式 | 拡張子 | MIME タイプ |
|------|--------|------------|
| MP3  | `.mp3` | `audio/mpeg` |
| WAV  | `.wav` | `audio/wav`, `audio/wave`, `audio/x-wav` |

※ ブラウザの Web Audio API がデコードできる形式であれば動作します。

## 技術仕様

### BPM 検出アルゴリズム

3 つの手法を組み合わせたマルチメソッド方式で BPM を推定します。

#### 1. マルチバンドスペクトルフラックス（オンセット検出）

- Radix-2 FFT（2048 点、ホップサイズ 512）で各フレームの周波数スペクトルを算出
- 6 帯域（0-200 / 200-400 / 400-800 / 800-1600 / 1600-3200 / 3200+ Hz）に分割
- 各帯域・各周波数ビンごとにマグニチュード差分を半波整流し、スペクトルフラックスを算出
- 低域のキックから高域のハイハットまで独立に音の立ち上がりを検出

#### 2. 自己相関法（Autocorrelation）

- オンセット検出関数（ODF）に対して正規化自己相関を計算
- 60〜200 BPM に対応するラグ範囲を走査
- 2 倍・3 倍ラグの自己相関値を加算して倍音整合性をブースト（Enhanced Autocorrelation）
- 周期的なビートパターンを直接検出

#### 3. コムフィルタエナジー（Comb Filter）

- 各 BPM 候補（0.5 BPM 刻み）に対してビート位置で ODF 値を集計
- サブビート（2 分音符・3 連符・4 分音符）も重み付きで評価
- ビート位置周辺の局所最大値を取得し、位相ずれに対するロバスト性を確保

#### 4. スコア融合 + ハーモニック解決

- 自己相関（55%）とコムフィルタ（45%）のスコアを正規化して統合
- 80〜160 BPM 範囲に軽い優先度を付与（最も一般的なテンポ帯）
- 倍テンポ / 半テンポの曖昧さを自動解決

### その他の技術要素

| 要素 | 詳細 |
|------|------|
| 音声デコード | Web Audio API (`decodeAudioData`) |
| FFT | 自前実装の Radix-2 Cooley-Tukey アルゴリズム |
| 波形描画 | Canvas 2D（min/max バー描画、Retina 対応） |
| テスト音生成 | Raw PCM → WAV エンコード（16bit モノラル） |
| 外部依存 | なし（すべてブラウザ標準 API のみ） |

## 検出精度の目安と制限事項

### 精度の目安

| 入力 | 期待精度 |
|------|----------|
| クリック音・メトロノーム | ±0 BPM（正確に検出） |
| 四つ打ち系（EDM、テクノ） | ±1 BPM 以内 |
| ポップス・ロック | ±1〜2 BPM |
| 複雑なリズム・ジャズ | ±2〜5 BPM |

### 制限事項

- **テンポ変化のある楽曲:** 全体を通した平均的な BPM が検出されます。途中でテンポが変わる楽曲には対応していません
- **検出範囲:** 60〜200 BPM。この範囲外のテンポは検出できません
- **倍テンポの曖昧さ:** 例えば 70 BPM と 140 BPM の区別が困難な場合があります。アルゴリズムは 80〜160 BPM 範囲を優先します
- **非常に短い音声:** 3 秒未満の音声では精度が低下します
- **リズムが不明瞭な音声:** アンビエント、ドローン、フリージャズなど明確なビートがない楽曲では信頼度が低くなります
- **処理時間:** 長い音声ファイル（5 分以上）では、FFT 処理に数秒〜十数秒かかる場合があります

## ライセンス

MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
