const ANALYSER_TRACK_RETRY_INTERVAL_MS = 100;
const ANALYSER_TRACK_RETRY_LIMIT = 30;

export class GlobalAudioSpectrumAnalyser {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBins: Uint8Array | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private analyserStream: MediaStream | null = null;
  private analyserStreamAddTrackListener: (() => void) | null = null;
  private analyserSourceUrl: string | null = null;
  private setupInProgress = false;
  private setupGeneration = 0;
  private trackRetryCount = 0;
  private trackRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly audio: HTMLAudioElement) {}

  ensureReady(sourceUrl: string | null) {
    void this.ensureReadyInternal(sourceUrl);
  }

  readLevels(target: Float32Array, bandCount = target.length): boolean {
    const analyser = this.analyser;
    const bins = this.analyserBins;
    const context = this.audioContext;
    if (!analyser || !bins || !context || target.length === 0) return false;

    analyser.getByteFrequencyData(bins);
    const count = Math.min(Math.max(Math.floor(bandCount), 0), target.length);
    const nyquist = context.sampleRate / 2;
    const minimumFrequency = Math.min(45, nyquist);
    const maximumFrequency = Math.min(16_000, nyquist);
    const frequencyRatio = maximumFrequency / Math.max(minimumFrequency, 1);

    for (let index = 0; index < count; index += 1) {
      const ratio = count === 1 ? 0 : index / (count - 1);
      const frequency = minimumFrequency * Math.pow(frequencyRatio, ratio);
      const binPosition = Math.min(
        Math.max((frequency / nyquist) * (bins.length - 1), 0),
        bins.length - 1,
      );
      const firstIndex = Math.floor(binPosition);
      const secondIndex = Math.min(firstIndex + 1, bins.length - 1);
      const mix = binPosition - firstIndex;
      target[index] = ((bins[firstIndex] || 0) * (1 - mix) + (bins[secondIndex] || 0) * mix) / 255;
    }
    target.fill(0, count);
    return true;
  }

  reset() {
    this.setupGeneration += 1;
    this.setupInProgress = false;
    this.clearTrackWait();
    this.analyserSource?.disconnect();
    this.analyser?.disconnect();
    if (this.audioContext) {
      void this.audioContext.close();
    }
    this.audioContext = null;
    this.analyser = null;
    this.analyserBins = null;
    this.analyserSource = null;
    this.analyserStream = null;
    this.analyserSourceUrl = null;
  }

  private async ensureReadyInternal(sourceUrl: string | null) {
    if (
      this.audioContext
      && this.analyser
      && this.analyserSourceUrl === sourceUrl
    ) {
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch {
          // Audio playback remains available when spectrum analysis cannot resume.
        }
      }
      return;
    }
    if (
      !sourceUrl
      || this.audio.paused
      || this.setupInProgress
      || typeof AudioContext === 'undefined'
    ) return;
    const captureStream = (this.audio as HTMLAudioElement & {
      captureStream?: () => MediaStream;
    }).captureStream;
    if (typeof captureStream !== 'function') return;
    this.setupInProgress = true;
    const setupGeneration = this.setupGeneration;
    let pendingContext: AudioContext | null = null;

    try {
      const stream = this.analyserStream ?? captureStream.call(this.audio);
      if (setupGeneration !== this.setupGeneration) return;
      this.analyserStream = stream;
      if (stream.getAudioTracks().length === 0) {
        this.waitForTrack(stream, setupGeneration, sourceUrl);
        return;
      }
      this.clearTrackWait();
      const context = new AudioContext();
      pendingContext = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.58;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      if (setupGeneration !== this.setupGeneration) {
        source.disconnect();
        analyser.disconnect();
        void context.close();
        pendingContext = null;
        return;
      }
      this.audioContext = context;
      this.analyser = analyser;
      this.analyserBins = new Uint8Array(analyser.frequencyBinCount);
      this.analyserSource = source;
      this.analyserSourceUrl = sourceUrl;
      pendingContext = null;
      if (context.state === 'suspended') {
        try {
          await context.resume();
        } catch {
          // The next user-initiated play will retry resume without rebuilding the graph.
        }
      }
    } catch {
      if (pendingContext) {
        void pendingContext.close();
      }
      if (setupGeneration === this.setupGeneration) {
        this.reset();
      }
    } finally {
      if (setupGeneration === this.setupGeneration) {
        this.setupInProgress = false;
      }
    }
  }

  private waitForTrack(
    stream: MediaStream,
    setupGeneration: number,
    sourceUrl: string,
  ) {
    if (!this.analyserStreamAddTrackListener) {
      const handleAddTrack = () => {
        if (setupGeneration !== this.setupGeneration) return;
        this.ensureReady(sourceUrl);
      };
      stream.addEventListener('addtrack', handleAddTrack);
      this.analyserStreamAddTrackListener = handleAddTrack;
    }
    if (this.trackRetryTimer || this.trackRetryCount >= ANALYSER_TRACK_RETRY_LIMIT) return;
    this.trackRetryTimer = setTimeout(() => {
      this.trackRetryTimer = null;
      if (setupGeneration !== this.setupGeneration) return;
      this.trackRetryCount += 1;
      this.ensureReady(sourceUrl);
    }, ANALYSER_TRACK_RETRY_INTERVAL_MS);
  }

  private clearTrackWait() {
    if (this.trackRetryTimer) {
      clearTimeout(this.trackRetryTimer);
      this.trackRetryTimer = null;
    }
    if (this.analyserStream && this.analyserStreamAddTrackListener) {
      this.analyserStream.removeEventListener('addtrack', this.analyserStreamAddTrackListener);
    }
    this.analyserStreamAddTrackListener = null;
    this.trackRetryCount = 0;
  }
}
