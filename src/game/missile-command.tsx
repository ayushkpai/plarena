"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type Phase = "menu" | "playing" | "paused" | "over";

const W = 960;
const H = 600;

const GROUND_Y = H - 44;
const START_AMMO = 10;

const INTERCEPTOR_SPEED = 1150;
const EXPLOSION_MAX_R = 62;
const EXPLOSION_LIFE = 0.9;
const BLAST_RADIUS = 46;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

const BEST_KEY = "plarena.missileCommand.best";

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

const CITY_XS = [190, 280, 370, 590, 680, 770];
const BASE_XS = [90, 480, 870];

interface City {
  x: number;
  alive: boolean;
}

interface Base {
  x: number;
  alive: boolean;
  ammo: number;
  flash: number;
}

interface Missile {
  x: number;
  y: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  splitY: number;
  splitCount: number;
  splitDone: boolean;
  alive: boolean;
}

interface Interceptor {
  x: number;
  y: number;
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  dirX: number;
  dirY: number;
  alive: boolean;
}

interface Explosion {
  x: number;
  y: number;
  t: number;
  life: number;
  maxR: number;
  hostile: boolean;
  alive: boolean;
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
}

interface GameState {
  cities: City[];
  bases: Base[];
  missiles: Missile[];
  interceptors: Interceptor[];
  explosions: Explosion[];
  particles: Particle[];
  stars: Star[];
  score: number;
  wave: number;
  toSpawn: number;
  spawnTimer: number;
  waveClearTimer: number;
  shake: number;
  pointer: { x: number; y: number };
}

function makeStars(): Star[] {
  return Array.from({ length: 120 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (GROUND_Y - 120),
    r: rand(0.4, 1.5),
    tw: rand(0, Math.PI * 2),
  }));
}

function makeState(): GameState {
  const g: GameState = {
    cities: CITY_XS.map((x) => ({ x, alive: true })),
    bases: BASE_XS.map((x) => ({ x, alive: true, ammo: START_AMMO, flash: 0 })),
    missiles: [],
    interceptors: [],
    explosions: [],
    particles: [],
    stars: makeStars(),
    score: 0,
    wave: 1,
    toSpawn: 0,
    spawnTimer: 0,
    waveClearTimer: 0,
    shake: 0,
    pointer: { x: W / 2, y: H / 3 },
  };
  setupWave(g);
  return g;
}

function setupWave(g: GameState) {
  g.toSpawn = 8 + g.wave * 3;
  g.spawnTimer = 1.1;
  g.waveClearTimer = 0;
  for (const b of g.bases) {
    if (b.alive) b.ammo = START_AMMO;
  }
  if (g.wave > 1) {
    const destroyed = g.cities.find((c) => !c.alive);
    if (destroyed) destroyed.alive = true;
  }
}

function waveParams(wave: number) {
  return {
    speed: Math.min(150, 58 + wave * 7),
    interval: Math.max(0.16, 1.1 - wave * 0.075),
    mirvChance: wave >= 3 ? Math.min(0.4, (wave - 2) * 0.09) : 0,
  };
}

function nearestBase(g: GameState, x: number): Base | null {
  let best: Base | null = null;
  let bd = Infinity;
  for (const b of g.bases) {
    if (!b.alive || b.ammo <= 0) continue;
    const d = Math.abs(b.x - x);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

export default function MissileCommand() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<Phase>("menu");
  const gameRef = useRef<GameState | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const best = useSyncExternalStore(subscribeBest, readBest, getBestServerSnapshot);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const startGame = useCallback(() => {
    gameRef.current = makeState();
    setScore(0);
    setWave(1);
    setPhaseBoth("playing");
  }, [setPhaseBoth]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " ") e.preventDefault();
      const current = phaseRef.current;
      if (current === "menu" && (k === " " || k === "enter")) startGame();
      else if (current === "over" && (k === "r" || k === " " || k === "enter")) startGame();
      else if (current === "playing" && (k === "p" || k === "escape")) setPhaseBoth("paused");
      else if (current === "paused" && (k === "p" || k === "escape" || k === " ")) {
        setPhaseBoth("playing");
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
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
        update(g, dt, () => setScore(Math.floor(g.score)), () =>
          setWave(g.wave),
          () => {
            setScore(Math.floor(g.score));
            if (Math.floor(g.score) > readBest()) writeBest(Math.floor(g.score));
            setPhaseBoth("over");
          },
        );
      } else if (current === "menu") {
        updateAttract(g, dt);
      } else {
        g.shake = Math.max(0, g.shake - dt * 40);
        updateParticles(g, dt);
      }

      draw(ctx, g, dpr, now / 1000, current, nearestBase(g, g.pointer.x));
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [setPhaseBoth]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gameRef.current;
    if (!g) return;
    const p = pointerPos(e);
    g.pointer.x = p.x;
    g.pointer.y = p.y;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gameRef.current;
    if (!g) return;
    const p = pointerPos(e);
    g.pointer.x = p.x;
    g.pointer.y = p.y;
    if (phaseRef.current === "menu" || phaseRef.current === "over") {
      startGame();
      return;
    }
    if (phaseRef.current === "playing") fire(g, p.x, p.y);
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
          <span className="font-mono text-sm text-zinc-500">
            {best > 0 ? `BEST ${best}` : ""}
          </span>
        </div>

        <div className="group relative aspect-[8/5] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-[#04060f] shadow-2xl shadow-rose-500/5">
          <canvas
            ref={canvasRef}
            className="h-full w-full cursor-none touch-none"
            style={{ touchAction: "none" }}
            onPointerMove={onMove}
            onPointerDown={onDown}
          />

          {phase === "menu" && (
            <Overlay>
              <h1 className="bg-gradient-to-r from-amber-300 via-orange-400 to-rose-500 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
                Missile Command
              </h1>
              <p className="max-w-md text-center text-sm leading-6 text-zinc-400">
                Burning skies over the arena. Click to launch interceptors from the
                nearest silo and blast the incoming missiles before they hit your cities.
              </p>
              <div className="flex flex-col items-center gap-1 text-center text-xs text-zinc-500">
                <p>
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
                    Move
                  </span>{" "}
                  to aim ·{" "}
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
                    Click
                  </span>{" "}
                  to fire
                </p>
                <p>Each silo has limited ammo — refilled every wave.</p>
              </div>
              <StartButton onClick={startGame}>Defend</StartButton>
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
              <h2 className="text-4xl font-bold text-rose-400">All Cities Lost</h2>
              <div className="flex gap-8">
                <Stat label="Score" value={score} />
                <Stat label="Wave" value={wave} />
                <Stat label="Best" value={Math.max(best, score)} />
              </div>
              <StartButton onClick={startGame}>Defend Again</StartButton>
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/55 px-6 backdrop-blur-sm">
      {children}
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
      className="rounded-full bg-gradient-to-r from-amber-400 to-rose-500 px-7 py-2.5 text-sm font-semibold text-black shadow-lg shadow-rose-500/20 transition-transform hover:scale-105 active:scale-95"
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
      life: rand(0.3, 0.8),
      maxLife: 0.8,
      size: rand(1.4, 3.4),
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
}

function fire(g: GameState, x: number, y: number) {
  const base = nearestBase(g, x);
  if (!base) return;
  base.ammo -= 1;
  base.flash = 0.2;
  const sx = base.x;
  const sy = GROUND_Y - 12;
  const tx = Math.max(12, Math.min(W - 12, x));
  const ty = Math.min(GROUND_Y - 16, Math.max(12, y));
  const dx = tx - sx;
  const dy = ty - sy;
  const d = Math.hypot(dx, dy) || 1;
  g.interceptors.push({
    x: sx,
    y: sy,
    x0: sx,
    y0: sy,
    tx,
    ty,
    dirX: dx / d,
    dirY: dy / d,
    alive: true,
  });
}

function spawnMissile(g: GameState) {
  const { speed, mirvChance } = waveParams(g.wave);
  const targets: number[] = [];
  for (const c of g.cities) if (c.alive) targets.push(c.x);
  for (const b of g.bases) if (b.alive) targets.push(b.x);

  let tx: number;
  if (targets.length > 0 && Math.random() > 0.25) {
    tx = targets[Math.floor(Math.random() * targets.length)] + rand(-14, 14);
  } else {
    tx = rand(40, W - 40);
  }

  const sx = Math.random() * W;
  const sy = -10;
  const dx = tx - sx;
  const dy = GROUND_Y - sy;
  const d = Math.hypot(dx, dy) || 1;
  const isMirv = Math.random() < mirvChance;

  g.missiles.push({
    x: sx,
    y: sy,
    x0: sx,
    y0: sy,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    splitY: rand(0.22, 0.42) * GROUND_Y,
    splitCount: 2 + Math.floor(g.wave / 3),
    splitDone: !isMirv,
    alive: true,
  });
}

function splitMissile(g: GameState, m: Missile) {
  const { speed } = waveParams(g.wave);
  for (let i = 0; i < m.splitCount; i++) {
    const tx = rand(40, W - 40);
    const dx = tx - m.x;
    const dy = GROUND_Y - m.y;
    const d = Math.hypot(dx, dy) || 1;
    g.missiles.push({
      x: m.x,
      y: m.y,
      x0: m.x,
      y0: m.y,
      vx: (dx / d) * speed,
      vy: (dy / d) * speed,
      splitY: 0,
      splitCount: 0,
      splitDone: true,
      alive: true,
    });
  }
}

function update(
  g: GameState,
  dt: number,
  onScore: () => void,
  onWave: () => void,
  onGameOver: () => void,
) {
  g.shake = Math.max(0, g.shake - dt * 40);
  for (const b of g.bases) b.flash = Math.max(0, b.flash - dt);

  const { interval } = waveParams(g.wave);

  if (g.toSpawn > 0) {
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      spawnMissile(g);
      g.toSpawn -= 1;
      g.spawnTimer = interval;
    }
  }

  for (const m of g.missiles) {
    if (!m.alive) continue;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (!m.splitDone && m.y >= m.splitY) {
      m.splitDone = true;
      m.alive = false;
      splitMissile(g, m);
      burst(g.particles, m.x, m.y, 10, ["#fb7185", "#fca5a5"], 180);
    }
    if (m.y >= GROUND_Y) {
      m.alive = false;
      groundImpact(g, m.x, m.y);
    }
  }

  for (const it of g.interceptors) {
    if (!it.alive) continue;
    it.x += it.dirX * INTERCEPTOR_SPEED * dt;
    it.y += it.dirY * INTERCEPTOR_SPEED * dt;
    const remX = it.tx - it.x;
    const remY = it.ty - it.y;
    if (remX * it.dirX + remY * it.dirY <= 0) {
      it.alive = false;
      g.explosions.push({
        x: it.tx,
        y: it.ty,
        t: 0,
        life: EXPLOSION_LIFE,
        maxR: EXPLOSION_MAX_R,
        hostile: false,
        alive: true,
      });
      g.shake = Math.max(g.shake, 3);
    }
  }

  for (const e of g.explosions) {
    if (!e.alive) continue;
    e.t += dt;
    if (e.t >= e.life) e.alive = false;
  }

  for (const e of g.explosions) {
    if (!e.alive || e.hostile) continue;
    const u = e.t / e.life;
    const r = e.maxR * Math.sin(Math.PI * Math.min(1, u));
    if (r <= 0) continue;
    for (const m of g.missiles) {
      if (!m.alive) continue;
      if (Math.hypot(m.x - e.x, m.y - e.y) < r) {
        m.alive = false;
        g.score += 25;
        burst(g.particles, m.x, m.y, 12, ["#fda4af", "#fecdd3", "#f87171"], 220);
      }
    }
  }

  g.missiles = g.missiles.filter((m) => m.alive);
  g.interceptors = g.interceptors.filter((it) => it.alive);
  g.explosions = g.explosions.filter((e) => e.alive);

  updateParticles(g, dt);
  onScore();

  const noCities = g.cities.every((c) => !c.alive);
  if (noCities) {
    onGameOver();
    return;
  }

  if (g.toSpawn === 0 && g.missiles.length === 0) {
    g.waveClearTimer += dt;
    if (g.waveClearTimer > 1.6) {
      g.score += g.cities.filter((c) => c.alive).length * 100;
      g.score += g.bases.reduce((s, b) => s + (b.alive ? b.ammo : 0), 0) * 5;
      g.wave += 1;
      setupWave(g);
      onWave();
    }
  } else {
    g.waveClearTimer = 0;
  }
}

function groundImpact(g: GameState, x: number, y: number) {
  g.shake = 12;
  g.explosions.push({
    x,
    y,
    t: 0,
    life: 0.7,
    maxR: BLAST_RADIUS + 24,
    hostile: true,
    alive: true,
  });
  burst(g.particles, x, y, 30, ["#f97316", "#fbbf24", "#f87171"], 320);
  for (const c of g.cities) {
    if (c.alive && Math.abs(c.x - x) < BLAST_RADIUS) c.alive = false;
  }
  for (const b of g.bases) {
    if (b.alive && Math.abs(b.x - x) < BLAST_RADIUS) b.alive = false;
  }
}

function updateAttract(g: GameState, dt: number) {
  g.shake = Math.max(0, g.shake - dt * 40);
  updateParticles(g, dt);
  for (const e of g.explosions) {
    e.t += dt;
  }
  g.explosions = g.explosions.filter((e) => e.t < e.life);
}

function updateParticles(g: GameState, dt: number) {
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 120 * dt;
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
  activeBase: Base | null,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#04060f");
  sky.addColorStop(0.7, "#0a1124");
  sky.addColorStop(1, "#1b1030");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y);

  for (const s of g.stars) {
    const alpha = 0.25 + 0.5 * Math.abs(Math.sin(t * 1.2 + s.tw));
    ctx.fillStyle = `rgba(200, 220, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  if (g.shake > 0) {
    ctx.translate(rand(-g.shake, g.shake) * 0.4, rand(-g.shake, g.shake) * 0.4);
  }

  drawGround(ctx, g);

  for (const m of g.missiles) drawTrail(ctx, m.x0, m.y0, m.x, m.y, "239, 68, 68");
  for (const it of g.interceptors) {
    drawTrail(ctx, it.x0, it.y0, it.x, it.y, "103, 232, 249");
  }

  for (const e of g.explosions) drawExplosion(ctx, e);

  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  drawHud(ctx, g);

  if (phase === "playing") {
    drawCrosshair(ctx, g, activeBase);
    if (g.toSpawn === 0 && g.missiles.length === 0) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
      ctx.font = "700 34px ui-monospace, Menlo, monospace";
      ctx.fillText("WAVE CLEARED", W / 2, H / 2 - 10);
      ctx.font = "600 16px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(226,232,240,0.7)";
      ctx.fillText("next wave incoming...", W / 2, H / 2 + 20);
      ctx.restore();
    }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: string,
) {
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, `rgba(${rgb}, 0)`);
  grad.addColorStop(0.7, `rgba(${rgb}, 0.35)`);
  grad.addColorStop(1, `rgba(${rgb}, 0.95)`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  ctx.fillStyle = `rgba(255, 255, 255, 0.95)`;
  ctx.shadowColor = `rgb(${rgb})`;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(x1, y1, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawExplosion(ctx: CanvasRenderingContext2D, e: Explosion) {
  const u = Math.min(1, e.t / e.life);
  const r = e.maxR * Math.sin(Math.PI * u);
  if (r <= 0) return;
  const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
  if (e.hostile) {
    grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    grad.addColorStop(0.4, "rgba(251, 146, 60, 0.8)");
    grad.addColorStop(1, "rgba(220, 38, 38, 0)");
  } else {
    grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    grad.addColorStop(0.4, "rgba(56, 189, 248, 0.75)");
    grad.addColorStop(1, "rgba(56, 189, 248, 0)");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawGround(ctx: CanvasRenderingContext2D, g: GameState) {
  ctx.fillStyle = "#0a0f1c";
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  const glow = ctx.createLinearGradient(0, GROUND_Y - 30, 0, GROUND_Y);
  glow.addColorStop(0, "rgba(56, 189, 248, 0)");
  glow.addColorStop(1, "rgba(56, 189, 248, 0.18)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, GROUND_Y - 30, W, 30);

  ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(W, GROUND_Y);
  ctx.stroke();

  for (const c of g.cities) drawCity(ctx, c);
  for (const b of g.bases) drawBase(ctx, b);
}

const CITY_SHAPE = [
  { dx: -32, w: 12, h: 20 },
  { dx: -18, w: 14, h: 30 },
  { dx: -2, w: 12, h: 24 },
  { dx: 12, w: 14, h: 34 },
  { dx: 28, w: 10, h: 22 },
];

function drawCity(ctx: CanvasRenderingContext2D, c: City) {
  if (!c.alive) {
    ctx.fillStyle = "rgba(120, 60, 70, 0.35)";
    ctx.fillRect(c.x - 32, GROUND_Y - 8, 66, 8);
    return;
  }
  for (const s of CITY_SHAPE) {
    const x = c.x + s.dx;
    const y = GROUND_Y - s.h;
    ctx.fillStyle = "#1e3a5f";
    ctx.fillRect(x, y, s.w, s.h);
    ctx.strokeStyle = "rgba(125, 211, 252, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, s.w, s.h);
    ctx.fillStyle = "rgba(250, 204, 21, 0.85)";
    for (let wy = y + 4; wy < GROUND_Y - 4; wy += 7) {
      for (let wx = x + 3; wx < x + s.w - 3; wx += 5) {
        if ((wx + wy) % 3 === 0) ctx.fillRect(wx, wy, 2, 3);
      }
    }
  }
}

function drawBase(ctx: CanvasRenderingContext2D, b: Base) {
  ctx.save();
  if (!b.alive) {
    ctx.fillStyle = "rgba(120, 60, 70, 0.35)";
    ctx.fillRect(b.x - 28, GROUND_Y - 8, 56, 8);
    ctx.restore();
    return;
  }
  ctx.fillStyle = b.flash > 0 ? "#fef08a" : "#7dd3fc";
  ctx.beginPath();
  ctx.moveTo(b.x - 26, GROUND_Y);
  ctx.lineTo(b.x + 26, GROUND_Y);
  ctx.lineTo(b.x + 14, GROUND_Y - 18);
  ctx.lineTo(b.x - 14, GROUND_Y - 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(8, 20, 35, 0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const ticks = Math.max(0, b.ammo);
  for (let i = 0; i < START_AMMO; i++) {
    ctx.fillStyle = i < ticks ? "#facc15" : "rgba(148, 163, 184, 0.25)";
    ctx.fillRect(b.x - 22 + i * 4.6, GROUND_Y + 6, 3.4, 8);
  }
  ctx.restore();
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  g: GameState,
  activeBase: Base | null,
) {
  const { x, y } = g.pointer;
  const color = activeBase ? "rgba(103, 232, 249, 0.9)" : "rgba(244, 63, 94, 0.9)";

  if (activeBase) {
    ctx.save();
    ctx.strokeStyle = "rgba(103, 232, 249, 0.25)";
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(activeBase.x, GROUND_Y - 12);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 20, y);
  ctx.lineTo(x - 8, y);
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x + 20, y);
  ctx.moveTo(x, y - 20);
  ctx.lineTo(x, y - 8);
  ctx.moveTo(x, y + 8);
  ctx.lineTo(x, y + 20);
  ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, g: GameState) {
  ctx.save();
  ctx.font = "600 22px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "left";
  ctx.fillText(`${Math.floor(g.score)}`, 24, 38);

  ctx.textAlign = "right";
  ctx.fillStyle = "#fbbf24";
  ctx.font = "700 18px ui-monospace, Menlo, monospace";
  ctx.fillText(`WAVE ${g.wave}`, W - 24, 36);
  ctx.restore();
}
