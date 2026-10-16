"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { engineStop, engineUpdate, sfx } from "@/lib/sound";

type Phase = "menu" | "playing" | "paused" | "over";
type Result = "crash" | "finish" | null;

const W = 960;
const H = 600;

const CX = W / 2;
const CY = H * 0.44;
const FOCAL = 360;

const W_HALF = 155;
const H_HALF = 84;
const CAR_HALF = 16;
const COLLISION_GRACE = 10;

const NEAR = 14;
const FAR = 3000;
const SLICES = 88;

const TRACK_LENGTH = 7000;

const MAX_SPEED = 300;
const MIN_SPEED = 70;
const ACCEL = 260;
const BRAKE = 420;
const COAST = 80;

const STEER_ACC = 4400;
const LAT_DRAG = 5;
const MAX_LAT = 950;

const FOG: [number, number, number] = [8, 11, 22];

const FLOOR: [number, number, number] = [28, 34, 50];
const CEIL: [number, number, number] = [20, 26, 40];
const WALL_L: [number, number, number] = [58, 70, 104];
const WALL_R: [number, number, number] = [48, 60, 92];

const rand = (min: number, max: number) => min + Math.random() * (max - min);

const BEST_KEY = "plarena.corridorRun.best";

let bestCache = 0;
let bestLoaded = false;
const bestListeners = new Set<() => void>();

function readBest() {
  if (!bestLoaded && typeof window !== "undefined") {
    bestLoaded = true;
    try {
      const stored = window.localStorage.getItem(BEST_KEY);
      const n = stored ? Number(stored) : 0;
      if (Number.isFinite(n)) bestCache = n;
    } catch {
      bestCache = 0;
    }
  }
  return bestCache;
}

function writeBest(value: number) {
  bestCache = value;
  bestLoaded = true;
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // storage unavailable
  }
  bestListeners.forEach((listener) => listener());
}

function subscribeBest(callback: () => void) {
  bestListeners.add(callback);
  return () => bestListeners.delete(callback);
}

function getBestServerSnapshot() {
  return 0;
}

const SLICE_DEPTHS = (() => {
  const arr: number[] = [];
  const ratio = FAR / NEAR;
  for (let i = 0; i <= SLICES; i++) {
    arr.push(NEAR * Math.pow(ratio, i / SLICES));
  }
  return arr;
})();

function curveX(d: number) {
  return 135 * Math.sin(d * 0.0025) + 58 * Math.sin(d * 0.0075 + 2);
}

function curveY(d: number) {
  return 40 * Math.sin(d * 0.0038 + 0.6) + 18 * Math.sin(d * 0.0095 + 1.7);
}

interface GameState {
  dist: number;
  lateral: number;
  latVel: number;
  lateralRender: number;
  speed: number;
  time: number;
  shake: number;
  flash: number;
  stars: { x: number; y: number; r: number }[];
}

function makeState(): GameState {
  return {
    dist: 0,
    lateral: curveX(0),
    latVel: 0,
    lateralRender: curveX(0),
    speed: 0,
    time: 0,
    shake: 0,
    flash: 0,
    stars: Array.from({ length: 90 }, () => ({
      x: Math.random() * W,
      y: Math.random() * CY,
      r: rand(0.4, 1.5),
    })),
  };
}

function mix(
  base: [number, number, number],
  factor: number,
  z: number,
): string {
  const fogT = Math.min(1, Math.pow(z / (FAR * 0.92), 1.15));
  const r = base[0] * factor * (1 - fogT) + FOG[0] * fogT;
  const g = base[1] * factor * (1 - fogT) + FOG[1] * fogT;
  const b = base[2] * factor * (1 - fogT) + FOG[2] * fogT;
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

export default function CorridorRun() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<Phase>("menu");
  const gameRef = useRef<GameState | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const [phase, setPhase] = useState<Phase>("menu");
  const [result, setResult] = useState<Result>(null);
  const [timeMs, setTimeMs] = useState(0);
  const best = useSyncExternalStore(subscribeBest, readBest, getBestServerSnapshot);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const startGame = useCallback(() => {
    gameRef.current = makeState();
    setResult(null);
    setTimeMs(0);
    setPhaseBoth("playing");
    sfx.start();
  }, [setPhaseBoth]);

  const finish = useCallback(
    (r: Exclude<Result, null>, elapsed: number) => {
      setResult(r);
      const ms = Math.round(elapsed * 1000);
      setTimeMs(ms);
      if (r === "finish" && (readBest() === 0 || ms < readBest())) {
        writeBest(ms);
      }
      setPhaseBoth("over");
      if (r === "finish") sfx.win();
      else sfx.crash();
    },
    [setPhaseBoth],
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        e.preventDefault();
      }
      keysRef.current.add(k);
      const current = phaseRef.current;

      if (current === "menu") {
        if (k === " " || k === "enter") startGame();
      } else if (current === "over") {
        if (k === "r" || k === " " || k === "enter") startGame();
      } else if (current === "playing") {
        if (k === "p" || k === "escape") setPhaseBoth("paused");
      } else if (current === "paused") {
        if (k === "p" || k === "escape" || k === " ") setPhaseBoth("playing");
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    const blur = () => keysRef.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [startGame, setPhaseBoth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;

    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!gameRef.current) gameRef.current = makeState();
      const g = gameRef.current;
      const current = phaseRef.current;

      if (current === "playing") {
        update(g, dt, keysRef.current, finish);
        engineUpdate((g.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
      } else if (current === "menu") {
        updateAttract(g, dt);
        engineStop();
      } else {
        g.shake = Math.max(0, g.shake - dt * 30);
        g.flash = Math.max(0, g.flash - dt * 2.2);
        engineStop();
      }

      draw(ctx, g, dpr, now / 1000, current);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      engineStop();
    };
  }, [finish]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
      <div className="w-full max-w-[960px]">
        <div className="mb-3 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Plarena
          </Link>
          <span className="font-mono text-sm text-zinc-500">
            {best > 0 ? `BEST ${(best / 1000).toFixed(2)}s` : ""}
          </span>
        </div>

        <div className="group relative aspect-[8/5] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-[#05070f] shadow-2xl shadow-cyan-500/5">
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            onPointerDown={() => {
              if (phaseRef.current === "menu" || phaseRef.current === "over") {
                startGame();
              }
            }}
          />

          {phase === "menu" && (
            <Overlay>
              <h1 className="bg-gradient-to-r from-lime-300 via-emerald-400 to-cyan-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
                Corridor Run
              </h1>
              <p className="max-w-md text-center text-sm leading-6 text-zinc-400">
                A cramped tunnel with twists and turns. Reach the finish line — but
                touch a wall and it&apos;s over.
              </p>
              <Controls />
              <StartButton onClick={startGame}>Start Engine</StartButton>
            </Overlay>
          )}

          {phase === "paused" && (
            <Overlay>
              <h2 className="text-3xl font-bold text-zinc-100">Paused</h2>
              <p className="text-sm text-zinc-400">Press P or Esc to resume.</p>
              <StartButton onClick={() => setPhaseBoth("playing")}>Resume</StartButton>
            </Overlay>
          )}

          {phase === "over" && (
            <Overlay>
              <h2
                className={`text-4xl font-bold ${result === "finish" ? "text-emerald-400" : "text-rose-400"}`}
              >
                {result === "finish" ? "Finish!" : "Crashed"}
              </h2>
              <p className="text-sm text-zinc-400">
                {result === "finish"
                  ? "You threaded the corridor."
                  : "You touched the wall."}
              </p>
              <div className="flex gap-8">
                <Stat label="Time" value={`${(timeMs / 1000).toFixed(2)}s`} />
                <Stat
                  label="Best"
                  value={best > 0 ? `${(best / 1000).toFixed(2)}s` : "—"}
                />
              </div>
              <StartButton onClick={startGame}>Run Again</StartButton>
              <p className="text-xs text-zinc-500">or press R</p>
            </Overlay>
          )}
        </div>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/55 backdrop-blur-sm">
      {children}
    </div>
  );
}

function Controls() {
  return (
    <div className="flex flex-col items-center gap-1 text-center text-xs text-zinc-500">
      <p>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">A</span>{" "}
        /{" "}
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">D</span>{" "}
        or arrow keys to steer
      </p>
      <p>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">W</span>{" "}
        accelerate ·{" "}
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">S</span>{" "}
        brake
      </p>
    </div>
  );
}

function StartButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-gradient-to-r from-lime-400 to-cyan-500 px-7 py-2.5 text-sm font-semibold text-black shadow-lg shadow-emerald-500/20 transition-transform hover:scale-105 active:scale-95"
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="font-mono text-3xl font-bold text-zinc-100">{value}</span>
    </div>
  );
}

function update(
  g: GameState,
  dt: number,
  keys: Set<string>,
  onFinish: (r: Exclude<Result, null>, elapsed: number) => void,
) {
  g.time += dt;
  g.shake = Math.max(0, g.shake - dt * 30);
  g.flash = Math.max(0, g.flash - dt * 2.2);

  let steer = 0;
  if (keys.has("arrowleft") || keys.has("a")) steer -= 1;
  if (keys.has("arrowright") || keys.has("d")) steer += 1;

  if (keys.has("arrowup") || keys.has("w")) {
    g.speed = Math.min(MAX_SPEED, g.speed + ACCEL * dt);
  } else if (keys.has("arrowdown") || keys.has("s")) {
    g.speed = Math.max(MIN_SPEED, g.speed - BRAKE * dt);
  } else {
    g.speed = Math.max(MIN_SPEED, g.speed - COAST * dt);
  }

  g.latVel += steer * STEER_ACC * dt;
  g.latVel *= Math.max(0, 1 - LAT_DRAG * dt);
  if (g.latVel > MAX_LAT) g.latVel = MAX_LAT;
  else if (g.latVel < -MAX_LAT) g.latVel = -MAX_LAT;
  g.lateral += g.latVel * dt;

  g.dist += g.speed * dt;
  g.lateralRender += (g.lateral - g.lateralRender) * Math.min(1, dt * 14);

  const rel = g.lateral - curveX(g.dist);
  const tolerance = W_HALF - CAR_HALF + COLLISION_GRACE;
  if (Math.abs(rel) > tolerance) {
    g.shake = 18;
    g.flash = 1;
    onFinish("crash", g.time);
    return;
  }

  if (g.dist >= TRACK_LENGTH) {
    onFinish("finish", g.time);
  }
}

function updateAttract(g: GameState, dt: number) {
  g.dist += 170 * dt;
  if (g.dist > TRACK_LENGTH) {
    g.dist = 0;
  }
  g.lateral = curveX(g.dist);
  g.lateralRender = g.lateral;
  g.latVel = 0;
  g.speed = 170;
}

function draw(
  ctx: CanvasRenderingContext2D,
  g: GameState,
  dpr: number,
  t: number,
  phase: Phase,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#05070f");
  bg.addColorStop(1, "#0a1020");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (const s of g.stars) {
    ctx.fillStyle = `rgba(148, 180, 220, ${0.2 + 0.4 * Math.abs(Math.sin(t + s.x))})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  if (g.shake > 0) {
    ctx.translate(rand(-g.shake, g.shake) * 0.4, rand(-g.shake, g.shake) * 0.4);
  }

  drawCorridor(ctx, g);
  drawFinishGate(ctx, g);

  if (phase !== "menu") {
    drawSpeedLines(ctx, g);
  }
  ctx.restore();

  if (phase !== "menu") {
    drawCockpit(ctx, g);
    drawHud(ctx, g);
  }

  if (g.flash > 0) {
    ctx.fillStyle = `rgba(244, 63, 94, ${g.flash * 0.4})`;
    ctx.fillRect(0, 0, W, H);
  }

  const rel = g.lateral - curveX(g.dist);
  const warn = Math.min(
    1,
    Math.max(0, (Math.abs(rel) - (W_HALF - CAR_HALF + COLLISION_GRACE - 55)) / 55),
  );
  if (warn > 0 && phase === "playing") {
    const side = rel > 0 ? 1 : -1;
    const grad = ctx.createLinearGradient(
      side > 0 ? W : 0,
      0,
      side > 0 ? W - 260 : 260,
      0,
    );
    grad.addColorStop(0, `rgba(244, 63, 94, ${0.45 * warn})`);
    grad.addColorStop(1, "rgba(244, 63, 94, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawCorridor(ctx: CanvasRenderingContext2D, g: GameState) {
  const playerY = curveY(g.dist);
  const n = SLICES + 1;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const T = new Float32Array(n);
  const B = new Float32Array(n);

  for (let j = 0; j < n; j++) {
    const z = SLICE_DEPTHS[j];
    const s = FOCAL / z;
    const d = g.dist + z;
    const cx = CX + (curveX(d) - g.lateralRender) * s;
    const cy = CY + (curveY(d) - playerY) * s;
    const hw = W_HALF * s;
    const hh = H_HALF * s;
    L[j] = cx - hw;
    R[j] = cx + hw;
    T[j] = cy - hh;
    B[j] = cy + hh;
  }

  for (let k = SLICES - 1; k >= 0; k--) {
    const j = k;
    const j2 = k + 1;
    const depth = SLICE_DEPTHS[j2];
    const dMid = g.dist + (SLICE_DEPTHS[j] + SLICE_DEPTHS[j2]) * 0.5;
    const band = Math.floor(dMid / 90) % 2 === 0 ? 1 : 0.78;
    const rib = Math.floor(dMid / 260) % 2 === 0;

    ctx.fillStyle = mix(FLOOR, band * (rib ? 1.35 : 1), depth);
    quad(ctx, L[j], B[j], R[j], B[j], R[j2], B[j2], L[j2], B[j2]);

    ctx.fillStyle = mix(CEIL, rib ? 1.9 : 0.6, depth);
    quad(ctx, L[j], T[j], R[j], T[j], R[j2], T[j2], L[j2], T[j2]);

    drawWall(
      ctx,
      L[j], T[j], L[j], B[j],
      L[j2], T[j2], L[j2], B[j2],
      WALL_L,
      band * (rib ? 1.25 : 1),
      depth,
    );
    drawWall(
      ctx,
      R[j], T[j], R[j], B[j],
      R[j2], T[j2], R[j2], B[j2],
      WALL_R,
      band * (rib ? 1.25 : 1),
      depth,
    );
  }

  ctx.strokeStyle = "rgba(148, 180, 220, 0.09)";
  ctx.lineWidth = 1;
  for (let j = 0; j < n; j += 5) {
    ctx.beginPath();
    ctx.moveTo(L[j], T[j]);
    ctx.lineTo(L[j], B[j]);
    ctx.moveTo(R[j], T[j]);
    ctx.lineTo(R[j], B[j]);
    ctx.stroke();
  }

  const rel = g.lateral - curveX(g.dist);
  const warn = Math.min(
    1,
    Math.max(0, (Math.abs(rel) - (W_HALF - CAR_HALF + COLLISION_GRACE - 55)) / 55),
  );
  const edgeColor = `rgba(${34 + warn * 210}, ${230 - warn * 170}, ${255 - warn * 90}, 0.9)`;

  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    if (j === 0) ctx.moveTo(L[j], T[j]);
    else ctx.lineTo(L[j], T[j]);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    if (j === 0) ctx.moveTo(R[j], T[j]);
    else ctx.lineTo(R[j], T[j]);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(103, 232, 249, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    if (j === 0) ctx.moveTo(L[j], B[j]);
    else ctx.lineTo(L[j], B[j]);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    if (j === 0) ctx.moveTo(R[j], B[j]);
    else ctx.lineTo(R[j], B[j]);
  }
  ctx.stroke();
}

function drawFinishGate(ctx: CanvasRenderingContext2D, g: GameState) {
  const zf = TRACK_LENGTH - g.dist;
  if (zf <= NEAR || zf >= FAR) return;
  const s = FOCAL / zf;
  const cx = CX + (curveX(TRACK_LENGTH) - g.lateralRender) * s;
  const cy = CY + (curveY(TRACK_LENGTH) - curveY(g.dist)) * s;
  const hw = W_HALF * s;
  const hh = H_HALF * s;
  const left = cx - hw;
  const right = cx + hw;
  const top = cy - hh;
  const bottom = cy + hh;

  const cols = 12;
  const rows = 6;
  const cw = (right - left) / cols;
  const ch = (bottom - top) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? "#f8fafc" : "#0f172a";
      ctx.fillRect(left + i * cw, top + j * ch, cw + 1, ch + 1);
    }
  }
  ctx.strokeStyle = "rgba(16, 185, 129, 0.85)";
  ctx.lineWidth = Math.max(2, 6 * s);
  ctx.strokeRect(left, top, right - left, bottom - top);
}

function drawSpeedLines(ctx: CanvasRenderingContext2D, g: GameState) {
  const intensity = Math.max(0, (g.speed - 170) / (MAX_SPEED - 170));
  if (intensity <= 0) return;
  ctx.save();
  ctx.strokeStyle = `rgba(165, 243, 252, ${0.18 * intensity})`;
  ctx.lineWidth = 2;
  const count = 26;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + g.dist * 0.002;
    const inner = 120 + (i % 3) * 40;
    const outer = inner + 160 + intensity * 220;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * inner, CY + Math.sin(a) * inner * 0.62);
    ctx.lineTo(CX + Math.cos(a) * outer, CY + Math.sin(a) * outer * 0.62);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCockpit(ctx: CanvasRenderingContext2D, g: GameState) {
  const dashTop = H * 0.72;
  const steer = Math.max(-1, Math.min(1, g.latVel / MAX_LAT));

  ctx.save();

  const dash = ctx.createLinearGradient(0, dashTop, 0, H);
  dash.addColorStop(0, "#0a0d18");
  dash.addColorStop(0.35, "#11161f");
  dash.addColorStop(1, "#05070c");
  ctx.fillStyle = dash;
  ctx.beginPath();
  ctx.moveTo(0, dashTop + 26);
  ctx.quadraticCurveTo(W / 2, dashTop - 46, W, dashTop + 26);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, dashTop + 26);
  ctx.quadraticCurveTo(W / 2, dashTop - 46, W, dashTop + 26);
  ctx.stroke();

  ctx.fillStyle = "#070a11";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(60, 0);
  ctx.lineTo(0, H * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W, 0);
  ctx.lineTo(W - 60, 0);
  ctx.lineTo(W, H * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#0c1018";
  roundRect(ctx, W / 2 - 90, 6, 180, 26, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1;
  roundRect(ctx, W / 2 - 90, 6, 180, 26, 10);
  ctx.stroke();

  const wheelX = W / 2 - steer * 34;
  const wheelY = dashTop + 74;
  ctx.strokeStyle = "#1b2330";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(wheelX, wheelY + 30, 108, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.strokeStyle = "#2b3648";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(wheelX, wheelY + 30, 108, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();

  drawSpeedo(ctx, g);
  ctx.restore();
}

function drawSpeedo(ctx: CanvasRenderingContext2D, g: GameState) {
  const cx = W - 150;
  const cy = H - 18;
  const r = 96;
  const start = Math.PI * 1.12;
  const end = Math.PI * 1.88;
  const frac = Math.max(0, Math.min(1, g.speed / MAX_SPEED));

  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();

  const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0, "#22d3ee");
  grad.addColorStop(1, "#f43f5e");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + (end - start) * frac);
  ctx.stroke();

  const a = start + (end - start) * frac;
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
  ctx.stroke();

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "700 26px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(g.speed)}`, cx, cy - 26);
  ctx.font = "600 11px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#64748b";
  ctx.fillText("KM/H", cx, cy - 8);
}

function drawHud(ctx: CanvasRenderingContext2D, g: GameState) {
  ctx.save();
  ctx.textAlign = "left";
  ctx.font = "600 20px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(`TIME ${g.time.toFixed(2)}s`, 24, 38);

  const remaining = Math.max(0, TRACK_LENGTH - g.dist);
  ctx.textAlign = "right";
  ctx.font = "600 13px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#7dd3fc";
  ctx.fillText(`${Math.round(remaining)} m`, W - 24, 38);

  const barW = W - 48;
  ctx.fillStyle = "rgba(148, 163, 184, 0.18)";
  ctx.fillRect(24, 52, barW, 6);
  const prog = Math.max(0, Math.min(1, g.dist / TRACK_LENGTH));
  const pgrad = ctx.createLinearGradient(24, 0, 24 + barW, 0);
  pgrad.addColorStop(0, "#34d399");
  pgrad.addColorStop(1, "#22d3ee");
  ctx.fillStyle = pgrad;
  ctx.fillRect(24, 52, barW * prog, 6);
  ctx.restore();
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  naTopX: number,
  naTopY: number,
  naBotX: number,
  naBotY: number,
  faTopX: number,
  faTopY: number,
  faBotX: number,
  faBotY: number,
  base: [number, number, number],
  shade: number,
  depth: number,
) {
  const gx = (naTopX + naBotX + faTopX + faBotX) / 4;
  const yTop = (naTopY + faTopY) / 2;
  const yBot = (naBotY + faBotY) / 2;
  const grad = ctx.createLinearGradient(gx, yTop, gx, yBot);
  grad.addColorStop(0, mix(base, shade * 0.4, depth));
  grad.addColorStop(0.45, mix(base, shade * 1.35, depth));
  grad.addColorStop(1, mix(base, shade * 0.5, depth));
  ctx.fillStyle = grad;
  quad(ctx, naTopX, naTopY, naBotX, naBotY, faBotX, faBotY, faTopX, faTopY);
}

function quad(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
