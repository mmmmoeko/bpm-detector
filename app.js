(() => {
  "use strict";

  // --- DOM Elements ---
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileInfo = document.getElementById("fileInfo");
  const fileName = document.getElementById("fileName");
  const removeFile = document.getElementById("removeFile");
  const progress = document.getElementById("progress");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const result = document.getElementById("result");
  const bpmValue = document.getElementById("bpmValue");
  const confidence = document.getElementById("confidence");
  const visualizer = document.getElementById("visualizer");
  const waveformCanvas = document.getElementById("waveformCanvas");
  const onsetCanvas = document.getElementById("onsetCanvas");
  const player = document.getElementById("player");
  const playBtn = document.getElementById("playBtn");

  let audioContext = null;
  let audioBuffer = null;
  let sourceNode = null;
  let isPlaying = false;

  // --- Drag & Drop ---
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  removeFile.addEventListener("click", resetUI);

  // --- Player ---
  playBtn.addEventListener("click", togglePlayback);

  function togglePlayback() {
    if (!audioBuffer || !audioContext) return;
    if (isPlaying) {
      stopPlayback();
    } else {
      sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(audioContext.destination);
      sourceNode.onended = () => {
        isPlaying = false;
        playBtn.textContent = "\u25B6 再生";
      };
      sourceNode.start(0);
      isPlaying = true;
      playBtn.textContent = "\u25A0 停止";
    }
  }

  function stopPlayback() {
    if (sourceNode) {
      sourceNode.onended = null;
      sourceNode.stop();
      sourceNode.disconnect();
      sourceNode = null;
    }
    isPlaying = false;
    playBtn.textContent = "\u25B6 再生";
  }

  // --- File Handling ---
  function handleFile(file) {
    const validTypes = ["audio/mpeg", "audio/wav", "audio/wave", "audio/x-wav"];
    const ext = file.name.split(".").pop().toLowerCase();
    if (!validTypes.includes(file.type) && !["mp3", "wav"].includes(ext)) {
      alert("MP3 または WAV ファイルを選択してください。");
      return;
    }

    stopPlayback();
    fileName.textContent = file.name;
    fileInfo.classList.remove("hidden");
    progress.classList.remove("hidden");
    result.classList.add("hidden");
    visualizer.classList.add("hidden");
    player.classList.add("hidden");
    updateProgress(0, "ファイルを読み込み中...");

    const reader = new FileReader();
    reader.onload = (e) => {
      updateProgress(20, "音声をデコード中...");
      decodeAndAnalyze(e.target.result);
    };
    reader.onerror = () => {
      updateProgress(0, "ファイルの読み込みに失敗しました");
    };
    reader.readAsArrayBuffer(file);
  }

  async function decodeAndAnalyze(arrayBuffer) {
    try {
      if (audioContext) audioContext.close();
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      updateProgress(40, "BPM を解析中...");

      setTimeout(() => {
        try {
          const analysisResult = detectBPM(audioBuffer);
          displayResult(analysisResult);
        } catch (err) {
          updateProgress(0, "解析中にエラーが発生しました: " + err.message);
        }
      }, 50);
    } catch {
      updateProgress(0, "音声ファイルのデコードに失敗しました");
    }
  }

  // ============================================================
  // BPM Detection — Multi-method fusion
  //
  // Pipeline:
  //   1. Mix to mono
  //   2. Multi-band spectral flux onset detection (via radix-2 FFT)
  //   3. Autocorrelation of onset function → BPM scores
  //   4. Comb filter energy → BPM scores
  //   5. Score fusion + harmonic disambiguation
  // ============================================================

  const BPM_MIN = 60;
  const BPM_MAX = 200;
  const HOP_SIZE = 512;
  const FFT_SIZE = 2048;

  function detectBPM(buffer) {
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;

    // Step 1: Mix to mono
    const numChannels = buffer.numberOfChannels;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < numChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / numChannels;
      }
    }

    updateProgress(45, "スペクトル解析中...");

    // Step 2: Multi-band spectral flux ODF
    const numFrames = Math.floor((length - FFT_SIZE) / HOP_SIZE);
    if (numFrames < 2) {
      return {
        bpm: 0, confidence: 0, mono, sampleRate,
        onsetFunction: new Float32Array(0), threshold: new Float32Array(0),
        hopSize: HOP_SIZE, numFrames: 0, onsets: [],
      };
    }
    const odf = computeMultiBandFlux(mono, numFrames, sampleRate);

    updateProgress(55, "オンセット検出中...");

    // Step 3: Normalize
    const odfNorm = normalizeSignal(odf);

    // Step 4: Onset peaks (for visualization)
    const adaptThresh = computeAdaptiveThreshold(odfNorm,
      Math.round(sampleRate / HOP_SIZE * 0.3), 0.8);
    const onsets = [];
    for (let i = 1; i < numFrames - 1; i++) {
      if (odfNorm[i] > adaptThresh[i] &&
          odfNorm[i] > odfNorm[i - 1] &&
          odfNorm[i] >= odfNorm[i + 1]) {
        onsets.push(i);
      }
    }

    updateProgress(65, "自己相関解析中...");

    // Step 5: Autocorrelation BPM scoring
    const acScores = autocorrelationBPM(odfNorm, sampleRate, numFrames);

    updateProgress(75, "コムフィルタ解析中...");

    // Step 6: Comb filter BPM scoring
    const combScores = combFilterBPM(odfNorm, sampleRate, numFrames);

    updateProgress(85, "スコア統合中...");

    // Step 7: Fuse + find best
    const { bpm, conf } = fusedBestBPM(acScores, combScores);

    updateProgress(90, "ビジュアライズ中...");

    return {
      bpm,
      confidence: conf,
      mono,
      sampleRate,
      onsetFunction: odfNorm,
      threshold: adaptThresh,
      hopSize: HOP_SIZE,
      numFrames,
      onsets,
    };
  }

  // ---- Radix-2 in-place FFT ----
  // Operates on separate re[] and im[] arrays of length N (must be power of 2)
  function fft(re, im, N) {
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }

    // Cooley-Tukey butterfly
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2;
      const angle = -2 * Math.PI / size;
      const wRe = Math.cos(angle);
      const wIm = Math.sin(angle);

      for (let i = 0; i < N; i += size) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j;
          const b = a + half;
          const tRe = curRe * re[b] - curIm * im[b];
          const tIm = curRe * im[b] + curIm * re[b];
          re[b] = re[a] - tRe;
          im[b] = im[a] - tIm;
          re[a] += tRe;
          im[a] += tIm;
          const newCurRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = newCurRe;
        }
      }
    }
  }

  // ---- Multi-band spectral flux ----
  function computeMultiBandFlux(mono, numFrames, sampleRate) {
    const odf = new Float32Array(numFrames);
    const halfFFT = FFT_SIZE / 2;
    const binWidth = sampleRate / FFT_SIZE;

    // Band edges in Hz
    const bandEdges = [0, 200, 400, 800, 1600, 3200, sampleRate / 2];
    const numBands = bandEdges.length - 1;

    // Pre-compute band bin ranges
    const bandBinLo = new Int32Array(numBands);
    const bandBinHi = new Int32Array(numBands);
    for (let b = 0; b < numBands; b++) {
      bandBinLo[b] = Math.max(0, Math.floor(bandEdges[b] / binWidth));
      bandBinHi[b] = Math.min(halfFFT, Math.ceil(bandEdges[b + 1] / binWidth));
    }

    // Pre-compute Hann window
    const win = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
    }

    // Reusable buffers
    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);
    const prevMag = new Float32Array(halfFFT);

    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * HOP_SIZE;

      // Window the signal
      for (let i = 0; i < FFT_SIZE; i++) {
        re[i] = mono[offset + i] * win[i];
        im[i] = 0;
      }

      // Compute FFT
      fft(re, im, FFT_SIZE);

      // Compute magnitude spectrum and spectral flux per band
      let totalFlux = 0;
      for (let b = 0; b < numBands; b++) {
        let bandFlux = 0;
        for (let k = bandBinLo[b]; k < bandBinHi[b]; k++) {
          const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
          const diff = mag - prevMag[k];
          if (diff > 0) bandFlux += diff; // Half-wave rectified
          prevMag[k] = mag;
        }
        totalFlux += bandFlux;
      }

      odf[frame] = totalFlux;
    }

    return odf;
  }

  // ---- Autocorrelation BPM ----
  function autocorrelationBPM(odf, sampleRate, numFrames) {
    const framesPerSec = sampleRate / HOP_SIZE;
    const lagMin = Math.floor(framesPerSec * 60 / BPM_MAX);
    const lagMax = Math.min(
      Math.ceil(framesPerSec * 60 / BPM_MIN),
      numFrames - 1
    );

    if (lagMin >= lagMax) return new Map();

    // Mean-subtract
    let mean = 0;
    for (let i = 0; i < numFrames; i++) mean += odf[i];
    mean /= numFrames;

    const centered = new Float32Array(numFrames);
    let energy = 0;
    for (let i = 0; i < numFrames; i++) {
      centered[i] = odf[i] - mean;
      energy += centered[i] * centered[i];
    }

    // Compute normalized autocorrelation at each lag
    const acByLag = new Float32Array(lagMax + 1);
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let sum = 0;
      const n = numFrames - lag;
      for (let i = 0; i < n; i++) {
        sum += centered[i] * centered[i + lag];
      }
      acByLag[lag] = energy > 0 ? sum / energy : 0;
    }

    // Enhanced autocorrelation: for each lag, also check at 2x and 3x lag
    // to boost harmonically consistent periods
    const enhanced = new Float32Array(lagMax + 1);
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let val = acByLag[lag];
      const lag2 = lag * 2;
      const lag3 = lag * 3;
      if (lag2 <= lagMax) val += acByLag[lag2] * 0.5;
      if (lag3 <= lagMax) val += acByLag[lag3] * 0.25;
      enhanced[lag] = val;
    }

    // Convert to BPM scores (0.1 BPM resolution)
    const scores = new Map();
    for (let lag = lagMin; lag <= lagMax; lag++) {
      if (enhanced[lag] <= 0) continue;
      const bpm = Math.round((framesPerSec * 60 / lag) * 10) / 10;
      if (bpm >= BPM_MIN && bpm <= BPM_MAX) {
        const prev = scores.get(bpm) || 0;
        scores.set(bpm, Math.max(prev, enhanced[lag]));
      }
    }

    return scores;
  }

  // ---- Comb filter BPM ----
  function combFilterBPM(odf, sampleRate, numFrames) {
    const framesPerSec = sampleRate / HOP_SIZE;
    const scores = new Map();

    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.5) {
      const interval = (framesPerSec * 60) / bpm;
      let energy = 0;
      let count = 0;

      // Sum ODF at beat positions with sub-beat harmonics
      const pulseWidthFrames = Math.max(1, Math.round(framesPerSec * 0.015)); // ~15ms window

      for (let mul = 1; mul <= 4; mul++) {
        const subInterval = interval / mul;
        const weight = mul === 1 ? 1.0 : mul === 2 ? 0.6 : mul === 3 ? 0.3 : 0.2;

        for (let pos = 0; pos < numFrames; pos += subInterval) {
          const center = Math.round(pos);
          if (center >= numFrames) break;

          // Sum around the beat position for some tolerance
          let localMax = 0;
          for (let d = -pulseWidthFrames; d <= pulseWidthFrames; d++) {
            const idx = center + d;
            if (idx >= 0 && idx < numFrames && odf[idx] > localMax) {
              localMax = odf[idx];
            }
          }
          energy += localMax * weight;
          count++;
        }
      }

      if (count > 0) {
        scores.set(bpm, energy / Math.sqrt(count));
      }
    }

    return scores;
  }

  // ---- Fuse scores and find best BPM ----
  function fusedBestBPM(acScores, combScores) {
    // Normalize each
    const acNorm = normalizeMap(acScores);
    const combNorm = normalizeMap(combScores);

    // Merge into unified BPM grid (round to 0.5)
    const fused = new Map();
    const allBPMs = new Set();
    for (const bpm of acNorm.keys()) allBPMs.add(Math.round(bpm * 2) / 2);
    for (const bpm of combNorm.keys()) allBPMs.add(Math.round(bpm * 2) / 2);

    for (const bpm of allBPMs) {
      const ac = findNearestScore(acNorm, bpm, 0.5);
      const comb = findNearestScore(combNorm, bpm, 0.5);
      fused.set(bpm, ac * 0.55 + comb * 0.45);
    }

    if (fused.size === 0) return { bpm: 0, conf: 0 };

    // Sort by score
    const sorted = [...fused.entries()].sort((a, b) => b[1] - a[1]);

    // Find best BPM with harmonic disambiguation
    let bestBPM = sorted[0][0];
    let bestScore = -1;

    // Evaluate top candidates
    const topThreshold = sorted[0][1] * 0.6;
    for (const [bpm, score] of sorted) {
      if (score < topThreshold) break;

      let adjusted = score;

      // Preference for 80-160 range
      if (bpm >= 80 && bpm <= 160) adjusted *= 1.08;
      else if (bpm >= 70 && bpm <= 170) adjusted *= 1.02;

      // Check if a harmonic partner is stronger
      const double = bpm * 2;
      const half = bpm / 2;
      let dominated = false;

      if (double <= BPM_MAX) {
        const dScore = findNearestScore(fused, double, 1);
        if (dScore > score * 0.8 && double >= 80 && double <= 160 && !(bpm >= 80 && bpm <= 160)) {
          dominated = true;
        }
      }
      if (half >= BPM_MIN) {
        const hScore = findNearestScore(fused, half, 1);
        if (hScore > score * 0.8 && half >= 80 && half <= 160 && !(bpm >= 80 && bpm <= 160)) {
          dominated = true;
        }
      }

      if (!dominated && adjusted > bestScore) {
        bestScore = adjusted;
        bestBPM = bpm;
      }
    }

    // Confidence: how dominant is the best vs non-harmonic alternatives
    let secondBest = 0;
    for (const [bpm, score] of sorted) {
      const ratio = bestBPM / bpm;
      const isHarmonic =
        Math.abs(ratio - 1) < 0.06 ||
        Math.abs(ratio - 2) < 0.12 ||
        Math.abs(ratio - 0.5) < 0.06 ||
        Math.abs(ratio - 3) < 0.12 ||
        Math.abs(ratio - 1 / 3) < 0.06 ||
        Math.abs(ratio - 1.5) < 0.1 ||
        Math.abs(ratio - 2 / 3) < 0.1;
      if (isHarmonic) continue;
      secondBest = score;
      break;
    }

    const rawConf = secondBest > 0
      ? (bestScore - secondBest) / (bestScore + secondBest)
      : 0.9;
    const conf = Math.min(1, Math.max(0, rawConf * 1.5 + 0.2));

    return {
      bpm: Math.round(bestBPM),
      conf,
    };
  }

  // ---- Utilities ----
  function findNearestScore(map, target, tolerance) {
    let best = 0;
    for (const [bpm, score] of map) {
      if (Math.abs(bpm - target) <= tolerance && score > best) {
        best = score;
      }
    }
    return best;
  }

  function normalizeSignal(arr) {
    let max = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > max) max = arr[i];
    }
    if (max === 0) return arr;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
    return out;
  }

  function normalizeMap(map) {
    let max = 0;
    for (const v of map.values()) {
      if (v > max) max = v;
    }
    if (max === 0) return new Map();
    const out = new Map();
    for (const [k, v] of map) out.set(k, v / max);
    return out;
  }

  function computeAdaptiveThreshold(signal, windowSize, multiplier) {
    const threshold = new Float32Array(signal.length);
    const halfWin = Math.floor(windowSize / 2);
    for (let i = 0; i < signal.length; i++) {
      const lo = Math.max(0, i - halfWin);
      const hi = Math.min(signal.length, i + halfWin + 1);
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += signal[j];
      threshold[i] = (sum / (hi - lo)) * multiplier + 0.05;
    }
    return threshold;
  }

  // ---- Display ----
  function displayResult(data) {
    updateProgress(100, "完了");

    bpmValue.textContent = data.bpm;

    const pct = Math.round(data.confidence * 100);
    let label;
    if (pct >= 70) label = "高";
    else if (pct >= 40) label = "中";
    else label = "低";
    confidence.textContent = `信頼度: ${label} (${pct}%)`;

    result.classList.remove("hidden");
    player.classList.remove("hidden");
    visualizer.classList.remove("hidden");

    drawWaveform(data.mono);
    drawOnsets(data);

    setTimeout(() => progress.classList.add("hidden"), 500);
  }

  // ---- Waveform Visualization ----
  function drawWaveform(mono) {
    const canvas = waveformCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const mid = height / 2;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#2e3345";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    const samplesPerPixel = Math.floor(mono.length / width);
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#6c5ce7");
    gradient.addColorStop(0.5, "#a29bfe");
    gradient.addColorStop(1, "#00cec9");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;

    for (let x = 0; x < width; x++) {
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, mono.length);
      let min = 1, max = -1;
      for (let i = start; i < end; i++) {
        if (mono[i] < min) min = mono[i];
        if (mono[i] > max) max = mono[i];
      }
      ctx.beginPath();
      ctx.moveTo(x, mid + min * mid * 0.9);
      ctx.lineTo(x, mid + max * mid * 0.9);
      ctx.stroke();
    }
  }

  // ---- Onset Visualization ----
  function drawOnsets(data) {
    const canvas = onsetCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const { onsetFunction, threshold, numFrames, onsets } = data;

    ctx.clearRect(0, 0, width, height);

    let maxVal = 0;
    for (let i = 0; i < numFrames; i++) {
      if (onsetFunction[i] > maxVal) maxVal = onsetFunction[i];
    }
    if (maxVal === 0) maxVal = 1;

    const framesPerPixel = numFrames / width;

    // ODF
    ctx.strokeStyle = "#6c5ce7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const frame = Math.floor(x * framesPerPixel);
      const y = height - (onsetFunction[frame] / maxVal) * height * 0.9 - 2;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Threshold
    ctx.strokeStyle = "rgba(253, 203, 110, 0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const frame = Math.floor(x * framesPerPixel);
      const y = height - (threshold[frame] / maxVal) * height * 0.9 - 2;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Onset markers
    ctx.strokeStyle = "rgba(0, 206, 201, 0.6)";
    ctx.lineWidth = 1;
    for (const onset of onsets) {
      const x = (onset / numFrames) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  // ---- UI ----
  function updateProgress(pct, text) {
    progressFill.style.width = pct + "%";
    progressText.textContent = text;
  }

  function resetUI() {
    stopPlayback();
    fileInput.value = "";
    fileInfo.classList.add("hidden");
    progress.classList.add("hidden");
    result.classList.add("hidden");
    visualizer.classList.add("hidden");
    player.classList.add("hidden");
    audioBuffer = null;
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  }
})();
