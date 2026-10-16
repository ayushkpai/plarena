const MUTED_KEY = "plarena.muted";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

let mutedCache = false;
let mutedLoaded = false;
const mutedListeners = new Set<() => void>();

function loadMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribeMuted(cb: () => void) {
  mutedListeners.add(cb);
  return () => mutedListeners.delete(cb);
}

export function readMuted(): boolean {
  if (!mutedLoaded && typeof window !== "undefined") {
    mutedLoaded = true;
    mutedCache = loadMuted();
  }
  return mutedCache;
}

export function getMutedServerSnapshot(): boolean {
  return false;
}

export function setMuted(v: boolean): void {
  mutedCache = v;
  mutedLoaded = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(MUTED_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  mutedListeners.forEach((listener) => listener());
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

type ToneOpts = {
  freq: number;
  type?: OscillatorType;
  duration?: number;
  gain?: number;
  delay?: number;
  sweepTo?: number;
  attack?: number;
};

function tone(o: ToneOpts) {
  if (readMuted()) return;
  const c = ensureContext();
  if (!c || !masterGain) return;
  const t = c.currentTime + (o.delay ?? 0);
  const duration = o.duration ?? 0.15;
  const attack = o.attack ?? 0.005;
  const peak = o.gain ?? 0.25;

  const osc = c.createOscillator();
  osc.type = o.type ?? "square";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t + duration);
  }

  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(g);
  g.connect(masterGain);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(o: {
  duration?: number;
  gain?: number;
  delay?: number;
  lowpass?: number;
  sweepTo?: number;
}) {
  if (readMuted()) return;
  const c = ensureContext();
  if (!c || !masterGain) return;
  const t = c.currentTime + (o.delay ?? 0);
  const duration = o.duration ?? 0.25;
  const peak = o.gain ?? 0.3;

  const frames = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;

  const g = c.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  if (o.lowpass) {
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(o.lowpass, t);
    if (o.sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, o.sweepTo),
        t + duration,
      );
    }
    src.connect(filter);
    filter.connect(g);
  } else {
    src.connect(g);
  }
  g.connect(masterGain);
  src.start(t);
}

export const sfx = {
  click() {
    tone({ freq: 620, type: "square", duration: 0.05, gain: 0.16 });
  },
  start() {
    tone({ freq: 440, type: "square", duration: 0.07, gain: 0.2 });
    tone({ freq: 660, type: "square", duration: 0.07, gain: 0.2, delay: 0.06 });
    tone({ freq: 880, type: "square", duration: 0.1, gain: 0.2, delay: 0.12 });
  },
  go() {
    tone({ freq: 880, type: "square", duration: 0.18, gain: 0.22 });
    tone({ freq: 1320, type: "square", duration: 0.12, gain: 0.14, delay: 0.05 });
  },
  pickup() {
    tone({ freq: 720, type: "square", duration: 0.08, gain: 0.2, sweepTo: 1080 });
  },
  shoot() {
    tone({ freq: 520, type: "sawtooth", duration: 0.12, gain: 0.18, sweepTo: 180 });
  },
  explode() {
    noise({ duration: 0.4, gain: 0.3, lowpass: 1200, sweepTo: 200 });
    tone({ freq: 200, type: "triangle", duration: 0.35, gain: 0.2, sweepTo: 40 });
  },
  hit() {
    tone({ freq: 220, type: "square", duration: 0.14, gain: 0.25, sweepTo: 90 });
    noise({ duration: 0.18, gain: 0.18, lowpass: 800 });
  },
  bump(strength: number) {
    const s = Math.min(1, strength / 500);
    tone({ freq: 180 + 420 * s, type: "triangle", duration: 0.09, gain: 0.12 + 0.2 * s });
  },
  crash() {
    noise({ duration: 0.5, gain: 0.4, lowpass: 900, sweepTo: 150 });
    tone({ freq: 140, type: "sawtooth", duration: 0.4, gain: 0.28, sweepTo: 40 });
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ freq: f, type: "square", duration: 0.14, gain: 0.2, delay: i * 0.1 }),
    );
  },
  lose() {
    [440, 349, 262, 196].forEach((f, i) =>
      tone({ freq: f, type: "triangle", duration: 0.22, gain: 0.22, delay: i * 0.13 }),
    );
  },
  wave() {
    [660, 880, 1100].forEach((f, i) =>
      tone({ freq: f, type: "square", duration: 0.1, gain: 0.2, delay: i * 0.06 }),
    );
  },
};
