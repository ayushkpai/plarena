"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { engineStop, engineUpdate, sfx } from "@/lib/sound";

type Phase = "menu" | "playing" | "paused" | "gameover";

const W = 960;
const H = 600;

const GRAVITY = 64;
const THRUST = 170;
const ROT_SPEED = 3.4;
const FUEL_MAX = 105;
const FUEL_RATE = 10.5;
const MAX_LAND_VX = 34;
const MAX_LAND_VY = 48;
const MAX_LAND_ANGLE = 0.3;
const LEG_DROP = 14;
const START_LIVES = 3;
const STEP_X = 20;

const BEST_KEY = "plarena.lunarLander.best";

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

interface Lander {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrusting: boolean;
}

interface TerrainPoint {
  x: number;
  y: number;
}

interface Pad {
  x: number;
  w: number;
  y: number;
}

interface Terrain {
  points: TerrainPoint[];
  pads: Pad[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
  speed: number;
}

interface Message {
  text: string;
  color: string;
  timer: number;
}

interface GameState {
  lander: Lander;
  terrain: Terrain;
  particles: Particle[];
  stars: Star[];
  score: number;
  level: number;
  lives: number;
  fuel: number;
  shake: number;
  message: Message | null;
  pointer: { active: boolean; x: number; y: number };
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function makeStars(): Star[] {
  return Array.from({ length: 140 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (H - 120),
    r: rand(0.4, 1.6),
    tw: rand(0, Math.PI * 2),
    speed: rand(0.15, 0.6),
  }));
}

function makeTerrain(level: number): Terrain {
  const points: TerrainPoint[] = [];
  let y = H - 80 - rand(0, 30);
  for (let x = 0; x <= W; x += STEP_X) {
    points.push({ x, y });
    y += rand(-16, 16);
    y = clamp(y, H - 150, H - 42);
  }

  const pads: Pad[] = [];
  const padCount = Math.max(2, 4 - Math.floor((level - 1) / 3));
  const pw = Math.max(52, 100 - (level - 1) * 6);
  const span = (W - 200) / padCount;
  for (let i = 0; i < padCount; i++) {
    const cx = rand(100 + i * span + pw / 2, 100 + (i + 1) * span - pw / 2);
    const padY = rand(H - 128, H - 58);
    const half = pw / 2;
    for (const p of points) {
      if (p.x >= cx - half && p.x <= cx + half) p.y = padY;
    }
    pads.push({ x: cx, w: pw, y: padY });
  }
  return { points, pads };
}

function surfaceAt(terrain: Terrain, x: number): { y: number; pad: boolean } {
  for (const pad of terrain.pads) {
    if (x >= pad.x - pad.w / 2 && x <= pad.x + pad.w / 2) {
      return { y: pad.y, pad: true };
    }
  }
  const idx = clamp(Math.floor(x / STEP_X), 0, terrain.points.length - 2);
  const p0 = terrain.points[idx];
  const p1 = terrain.points[idx + 1];
  const t = p1.x === p0.x ? 0 : (x - p0.x) / (p1.x - p0.x);
  return { y: p0.y + (p1.y - p0.y) * t, pad: false };
}

function makeState(): GameState {
  return {
    lander: {
      x: rand(W * 0.35, W * 0.65),
      y: 54,
      vx: rand(-40, 40),
      vy: 0,
      angle: rand(-0.4, 0.4),
      thrusting: false,
    },
    terrain: makeTerrain(1),
    particles: [],
    stars: makeStars(),
    score: 0,
    level: 1,
    lives: START_LIVES,
    fuel: FUEL_MAX,
    shake: 0,
    message: null,
    pointer: { active: false, x: W / 2, y: H / 2 },
  };
}

function spawnLevel(g: GameState, level: number) {
  g.level = level;
  g.terrain = makeTerrain(level);
  g.lander.x = rand(W * 0.35, W * 0.65);
  g.lander.y = 54;
  g.lander.vx = rand(-40, 40);
  g.lander.vy = 0;
  g.lander.angle = rand(-0.4, 0.4);
  g.lander.thrusting = false;
  g.fuel = FUEL_MAX;
}

function burst(
  particles: Particle[],
  x: number,
  y: number,
  count: number,
  colors: string[],
  power: number,
) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(0.2, 1) * power;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rand(0.35, 0.95),
      maxLife: 0.95,
      size: rand(1.5, 3.8),
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
}

export default function LunarLander() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<Phase>("menu");
  const gameRef = useRef<GameState | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const [phase, setPhase] = useState<Phase>("menu");
  const [finalScore, setFinalScore] = useState(0);
  const best = useSyncExternalStore(subscribeBest, readBest, getBestServerSnapshot);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const startGame = useCallback(() => {
    gameRef.current = makeState();
    setFinalScore(0);
    setPhaseBoth("playing");
    sfx.start();
  }, [setPhaseBoth]);

  const endGame = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const score = Math.floor(g.score);
    setFinalScore(score);
    if (score > readBest()) writeBest(score);
    setPhaseBoth("gameover");
    sfx.lose();
    engineStop();
  }, [setPhaseBoth]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        e.preventDefault();
      }
      keysRef.current.add(k);
      const current = phaseRef.current;
      if (current === "menu" && (k === " " || k === "enter")) {
        startGame();
      } else if (current === "gameover" && (k === "r" || k === " " || k === "enter")) {
        startGame();
      } else if (current === "playing" && (k === "p" || k === "escape")) {
        setPhaseBoth("paused");
      } else if (current === "paused" && (k === "p" || k === "escape" || k === " ")) {
        setPhaseBoth("playing");
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
        update(g, dt, keysRef.current, endGame);
      } else {
        updateIdle(g, dt);
        engineStop();
      }

      draw(ctx, g, dpr, now / 1000, current);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      engineStop();
    };
  }, [endGame]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointerPos(e);
    const g = gameRef.current;
    if (g) {
      g.pointer.active = true;
      g.pointer.x = p.x;
      g.pointer.y = p.y;
    }
    if (phaseRef.current === "menu") startGame();
    else if (phaseRef.current === "gameover") startGame();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gameRef.current;
    if (!g || !g.pointer.active) return;
    const p = pointerPos(e);
    g.pointer.x = p.x;
    g.pointer.y = p.y;
  };

  const onPointerUp = () => {
    const g = gameRef.current;
    if (g) g.pointer.active = false;
  };

  const onPointerLeave = () => {
    const g = gameRef.current;
    if (g) g.pointer.active = false;
  };

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
          <span className="font-mono text-sm text-zinc-500">BEST {best}</span>
        </div>

        <div className="group relative aspect-[8/5] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-[#05070f] shadow-2xl shadow-sky-500/5">
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
          />

          {phase === "menu" && (
            <Overlay>
              <h1 className="bg-gradient-to-r from-slate-100 via-sky-300 to-indigo-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
                Lunar Lander
              </h1>
              <p className="max-w-sm text-center text-sm leading-6 text-zinc-400">
                Guide the lander down to a lit pad. Touch down gently and upright —
                you only have so much fuel.
              </p>
              <Controls />
              <StartButton onClick={startGame}>Begin Descent</StartButton>
            </Overlay>
          )}

          {phase === "paused" && (
            <Overlay>
              <h2 className="text-3xl font-bold text-zinc-100">Paused</h2>
              <p className="text-sm text-zinc-400">Press P or Esc to resume.</p>
              <StartButton onClick={() => setPhaseBoth("playing")}>Resume</StartButton>
            </Overlay>
          )}

          {phase === "gameover" && (
            <Overlay>
              <h2 className="text-4xl font-bold text-rose-400">Mission Failed</h2>
              <div className="flex gap-8">
                <Stat label="Score" value={finalScore} />
                <Stat label="Best" value={Math.max(best, finalScore)} />
              </div>
              <StartButton onClick={startGame}>Try Again</StartButton>
              <p className="text-xs text-zinc-500">or press R</p>
            </Overlay>
          )}
        </div>
      </div>
    </div>
  );
}

function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
  };
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
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
          ←
        </span>{" "}
        /{" "}
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
          →
        </span>{" "}
        to rotate ·{" "}
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
          ↑
        </span>{" "}
        /{" "}
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
          Space
        </span>{" "}
        to thrust
      </p>
      <p>
        Touch: tap left / right to rotate, centre to thrust ·{" "}
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
          P
        </span>{" "}
        to pause
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
      onClick={onClick}
      className="rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-7 py-2.5 text-sm font-semibold text-black shadow-lg shadow-sky-500/20 transition-transform hover:scale-105 active:scale-95"
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
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
  onGameOver: () => void,
) {
  g.shake = Math.max(0, g.shake - dt * 30);
  if (g.message) {
    g.message.timer -= dt;
    if (g.message.timer <= 0) g.message = null;
  }

  const l = g.lander;

  let rot = 0;
  if (keys.has("arrowleft") || keys.has("a")) rot -= 1;
  if (keys.has("arrowright") || keys.has("d")) rot += 1;
  let thrust = keys.has("arrowup") || keys.has("w") || keys.has(" ");
  if (g.pointer.active) {
    if (g.pointer.x < W / 3) rot -= 1;
    else if (g.pointer.x > (2 * W) / 3) rot += 1;
    else thrust = true;
  }

  l.angle += rot * ROT_SPEED * dt;
  l.thrusting = thrust && g.fuel > 0;

  if (l.thrusting) {
    l.vx += Math.sin(l.angle) * THRUST * dt;
    l.vy -= Math.cos(l.angle) * THRUST * dt;
    g.fuel = Math.max(0, g.fuel - FUEL_RATE * dt);
    if (Math.random() < 0.9) {
      const nx = l.x - Math.sin(l.angle) * 12;
      const ny = l.y + Math.cos(l.angle) * 12;
      const dx = -Math.sin(l.angle);
      const dy = Math.cos(l.angle);
      g.particles.push({
        x: nx,
        y: ny,
        vx: dx * rand(90, 170) + rand(-25, 25),
        vy: dy * rand(90, 170) + rand(-25, 25),
        life: rand(0.15, 0.4),
        maxLife: 0.4,
        size: rand(1.6, 3.2),
        color: Math.random() < 0.5 ? "#fbbf24" : "#fb923c",
      });
    }
    engineUpdate(0.34);
  } else {
    engineStop();
  }

  l.vy += GRAVITY * dt;
  l.x += l.vx * dt;
  l.y += l.vy * dt;

  if (l.y < -140) {
    l.y = -140;
    l.vy = Math.max(0, l.vy);
  }

  const surf = surfaceAt(g.terrain, l.x);
  const offSide = l.x < -24 || l.x > W + 24;
  const tooLow = l.y > H + 40;

  if (offSide || tooLow || l.y + LEG_DROP >= surf.y) {
    const angleNorm = Math.atan2(Math.sin(l.angle), Math.cos(l.angle));
    const speedOk = Math.abs(l.vx) <= MAX_LAND_VX && Math.abs(l.vy) <= MAX_LAND_VY;
    const angleOk = Math.abs(angleNorm) <= MAX_LAND_ANGLE;
    const contactY = tooLow || offSide ? l.y + LEG_DROP : surf.y;

    if (!offSide && !tooLow && surf.pad && speedOk && angleOk) {
      const soft = Math.max(0, 1 - Math.abs(l.vy) / MAX_LAND_VY);
      const acc = Math.max(0, 1 - Math.abs(l.vx) / MAX_LAND_VX);
      const gained = 100 + Math.round(soft * 120 + acc * 80) + Math.round(g.fuel * 2) + g.level * 40;
      g.score += gained;
      g.message = { text: `Landed!  +${gained}`, color: "#4ade80", timer: 1.6 };
      sfx.win();
      spawnLevel(g, g.level + 1);
    } else {
      burst(g.particles, l.x, contactY, 44, ["#fb7185", "#f59e0b", "#fde68a", "#ffffff"], 420);
      g.shake = 18;
      g.lives -= 1;
      sfx.explode();
      if (g.lives <= 0) {
        onGameOver();
        return;
      }
      g.message = { text: "Crashed!", color: "#fb7185", timer: 1.4 };
      spawnLevel(g, g.level);
    }
  }

  updateParticles(g, dt);
}

function updateIdle(g: GameState, dt: number) {
  g.stars.forEach((star) => {
    star.tw += dt;
  });
  updateParticles(g, dt);
}

function updateParticles(g: GameState, dt: number) {
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= dt;
    if (p.life <= 0) g.particles.splice(i, 1);
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  g: GameState,
  dpr: number,
  t: number,
  phase: Phase,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#05060f");
  bg.addColorStop(1, "#0a0d1a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (const star of g.stars) {
    const alpha = 0.25 + 0.55 * Math.abs(Math.sin(t * star.speed + star.tw));
    ctx.beginPath();
    ctx.fillStyle = `rgba(203, 213, 225, ${alpha})`;
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  if (g.shake > 0) {
    ctx.translate(rand(-g.shake, g.shake) * 0.4, rand(-g.shake, g.shake) * 0.4);
  }

  drawTerrain(ctx, g.terrain);

  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawLander(ctx, g.lander);

  ctx.restore();

  if (phase === "playing" || phase === "paused") {
    drawHud(ctx, g);
  }

  if (g.message && phase === "playing") {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 30px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = g.message.color;
    ctx.globalAlpha = Math.min(1, g.message.timer * 2);
    ctx.fillText(g.message.text, W / 2, H * 0.32);
    ctx.restore();
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawTerrain(ctx: CanvasRenderingContext2D, terrain: Terrain) {
  const pts = terrain.points;

  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(W, H);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, H - 160, 0, H);
  grad.addColorStop(0, "#3a3f4c");
  grad.addColorStop(1, "#12141b");
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = "#8b95a7";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const pad of terrain.pads) {
    ctx.save();
    ctx.strokeStyle = "#fbbf24";
    ctx.shadowColor = "rgba(251, 191, 36, 0.8)";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pad.x - pad.w / 2, pad.y - 2);
    ctx.lineTo(pad.x + pad.w / 2, pad.y - 2);
    ctx.stroke();

    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.moveTo(pad.x - pad.w / 2, pad.y - 4);
    ctx.lineTo(pad.x - pad.w / 2 + 10, pad.y - 16);
    ctx.lineTo(pad.x - pad.w / 2 + 4, pad.y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pad.x + pad.w / 2, pad.y - 4);
    ctx.lineTo(pad.x + pad.w / 2 - 10, pad.y - 16);
    ctx.lineTo(pad.x + pad.w / 2 - 4, pad.y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawLander(ctx: CanvasRenderingContext2D, l: Lander) {
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate(l.angle);

  if (l.thrusting) {
    const len = rand(16, 28);
    const flame = ctx.createLinearGradient(0, 12, 0, 12 + len);
    flame.addColorStop(0, "rgba(253, 224, 71, 0.95)");
    flame.addColorStop(0.5, "rgba(251, 146, 60, 0.7)");
    flame.addColorStop(1, "rgba(239, 68, 68, 0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-5, 12);
    ctx.lineTo(5, 12);
    ctx.lineTo(0, 12 + len);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-6, 6);
  ctx.lineTo(-12, 15);
  ctx.lineTo(-16, 15);
  ctx.moveTo(6, 6);
  ctx.lineTo(12, 15);
  ctx.lineTo(16, 15);
  ctx.stroke();

  ctx.shadowColor = "rgba(186, 230, 253, 0.8)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#0e2233";
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.lineTo(10, -3);
  ctx.lineTo(8, 8);
  ctx.lineTo(-8, 8);
  ctx.lineTo(-10, -3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#e0f2fe";
  ctx.beginPath();
  ctx.arc(0, -4, 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#94a3b8";
  ctx.fillRect(-4, 8, 8, 5);
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, g: GameState) {
  ctx.save();
  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "left";
  ctx.fillText(`SCORE ${g.score}`, 22, 36);
  ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`LEVEL ${g.level}`, 22, 56);

  for (let i = 0; i < g.lives; i++) {
    const x = W - 26 - i * 24;
    ctx.save();
    ctx.translate(x, 30);
    ctx.scale(0.7, 0.7);
    ctx.fillStyle = "#0e2233";
    ctx.strokeStyle = "#7dd3fc";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(10, -3);
    ctx.lineTo(8, 8);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-10, -3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  const barW = 260;
  const bx = W - 26 - barW;
  const by = 24;
  ctx.fillStyle = "rgba(148, 163, 184, 0.2)";
  ctx.fillRect(bx, by, barW, 8);
  const frac = clamp(g.fuel / FUEL_MAX, 0, 1);
  const fgrad = ctx.createLinearGradient(bx, 0, bx + barW, 0);
  fgrad.addColorStop(0, frac > 0.25 ? "#38bdf8" : "#f43f5e");
  fgrad.addColorStop(1, frac > 0.25 ? "#818cf8" : "#fb7185");
  ctx.fillStyle = fgrad;
  ctx.fillRect(bx, by, barW * frac, 8);
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "left";
  ctx.fillText("FUEL", bx, by + 22);
  ctx.restore();
}
