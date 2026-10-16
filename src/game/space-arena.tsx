"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type Phase = "menu" | "playing" | "paused" | "gameover";

const W = 960;
const H = 600;

const SHIP_ACCEL = 620;
const SHIP_MAX_SPEED = 380;
const SHIP_DRAG = 1.5;
const SHIP_RADIUS = 12;
const START_LIVES = 3;
const INVULN_TIME = 2.2;

const BEST_KEY = "plarena.spaceArena.best";

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

interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  lives: number;
  invuln: number;
  thrusting: boolean;
}

interface Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  rotSpeed: number;
  verts: { a: number; d: number }[];
  craters: { a: number; d: number; r: number }[];
}

interface Orb {
  x: number;
  y: number;
  phase: number;
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

interface GameState {
  ship: Ship;
  asteroids: Asteroid[];
  orbs: Orb[];
  particles: Particle[];
  stars: Star[];
  score: number;
  elapsed: number;
  spawnTimer: number;
  orbTimer: number;
  shake: number;
  pointer: { active: boolean; x: number; y: number };
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function makeStars(): Star[] {
  return Array.from({ length: 140 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: rand(0.4, 1.6),
    tw: rand(0, Math.PI * 2),
    speed: rand(0.15, 0.6),
  }));
}

function makeAsteroid(speedScale: number): Asteroid {
  const r = rand(16, 40);
  const edge = Math.floor(rand(0, 4));
  let x = 0;
  let y = 0;
  if (edge === 0) {
    x = rand(0, W);
    y = -r;
  } else if (edge === 1) {
    x = W + r;
    y = rand(0, H);
  } else if (edge === 2) {
    x = rand(0, W);
    y = H + r;
  } else {
    x = -r;
    y = rand(0, H);
  }
  const targetX = rand(W * 0.2, W * 0.8);
  const targetY = rand(H * 0.2, H * 0.8);
  const angle = Math.atan2(targetY - y, targetX - x);
  const speed = rand(50, 115) * speedScale;
  const vertCount = Math.floor(rand(9, 13));
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    rot: rand(0, Math.PI * 2),
    rotSpeed: rand(-0.9, 0.9),
    verts: Array.from({ length: vertCount }, (_, i) => ({
      a: (i / vertCount) * Math.PI * 2,
      d: rand(0.72, 1),
    })),
    craters: Array.from({ length: Math.floor(rand(2, 5)) }, () => ({
      a: rand(0, Math.PI * 2),
      d: rand(0, 0.5),
      r: rand(2, 5),
    })),
  };
}

function makeOrb(): Orb {
  return {
    x: rand(70, W - 70),
    y: rand(70, H - 70),
    phase: rand(0, Math.PI * 2),
  };
}

function makeState(): GameState {
  return {
    ship: {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      lives: START_LIVES,
      invuln: 0,
      thrusting: false,
    },
    asteroids: [],
    orbs: [makeOrb(), makeOrb()],
    particles: [],
    stars: makeStars(),
    score: 0,
    elapsed: 0,
    spawnTimer: 0,
    orbTimer: 0,
    shake: 0,
    pointer: { active: false, x: W / 2, y: H / 2 },
  };
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
      life: rand(0.35, 0.9),
      maxLife: 0.9,
      size: rand(1.5, 3.6),
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
}

export default function SpaceArena() {
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
  }, [setPhaseBoth]);

  const endGame = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const score = Math.floor(g.score);
    setFinalScore(score);
    if (score > readBest()) writeBest(score);
    setPhaseBoth("gameover");
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
      const g = gameRef.current;
      const current = phaseRef.current;

      if (!g) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#05070f";
        ctx.fillRect(0, 0, W, H);
        return;
      }

      if (current === "playing") {
        update(g, dt, keysRef.current, endGame);
      } else {
        updateIdle(g, dt);
      }

      draw(ctx, g, dpr, now / 1000, current);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
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
          <span className="font-mono text-sm text-zinc-500">
            BEST {best}
          </span>
        </div>

        <div className="group relative aspect-[8/5] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-[#05070f] shadow-2xl shadow-cyan-500/5">
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
              <h1 className="bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
                Space Arena
              </h1>
              <p className="max-w-sm text-center text-sm leading-6 text-zinc-400">
                Pilot your rocket through the arena. Collect energy orbs and dodge the
                drifting asteroids for as long as you can.
              </p>
              <Controls />
              <StartButton onClick={startGame}>
                Launch
              </StartButton>
            </Overlay>
          )}

          {phase === "paused" && (
            <Overlay>
              <h2 className="text-3xl font-bold text-zinc-100">Paused</h2>
              <p className="text-sm text-zinc-400">Press P or Esc to resume.</p>
              <StartButton onClick={() => setPhaseBoth("playing")}>
                Resume
              </StartButton>
            </Overlay>
          )}

          {phase === "gameover" && (
            <Overlay>
              <h2 className="text-4xl font-bold text-rose-400">Game Over</h2>
              <div className="flex gap-8">
                <Stat label="Score" value={finalScore} />
                <Stat label="Best" value={Math.max(best, finalScore)} />
              </div>
              <StartButton onClick={startGame}>
                Fly Again
              </StartButton>
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
          WASD
        </span>{" "}
        /{" "}
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
          Arrows
        </span>{" "}
        to thrust · or drag with the mouse
      </p>
      <p>
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
      className="rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 px-7 py-2.5 text-sm font-semibold text-black shadow-lg shadow-cyan-500/20 transition-transform hover:scale-105 active:scale-95"
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
  onDeath: () => void,
) {
  g.elapsed += dt;
  const ramp = Math.min(1 + g.elapsed / 45, 2.8);
  const s = g.ship;

  s.invuln = Math.max(0, s.invuln - dt);
  g.score += dt * 6;

  let ax = 0;
  let ay = 0;
  if (keys.has("arrowup") || keys.has("w")) ay -= 1;
  if (keys.has("arrowdown") || keys.has("s")) ay += 1;
  if (keys.has("arrowleft") || keys.has("a")) ax -= 1;
  if (keys.has("arrowright") || keys.has("d")) ax += 1;
  if (g.pointer.active) {
    const dx = g.pointer.x - s.x;
    const dy = g.pointer.y - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 24) {
      ax += dx / dist;
      ay += dy / dist;
    }
  }
  const mag = Math.hypot(ax, ay);
  if (mag > 0) {
    ax /= mag;
    ay /= mag;
    s.vx += ax * SHIP_ACCEL * dt;
    s.vy += ay * SHIP_ACCEL * dt;
    s.thrusting = true;
    const rear = s.angle + Math.PI;
    if (Math.random() < 0.7) {
      g.particles.push({
        x: s.x + Math.cos(rear) * 10,
        y: s.y + Math.sin(rear) * 10,
        vx: Math.cos(rear) * rand(60, 140) - s.vx * 0.3 + rand(-30, 30),
        vy: Math.sin(rear) * rand(60, 140) - s.vy * 0.3 + rand(-30, 30),
        life: rand(0.2, 0.45),
        maxLife: 0.45,
        size: rand(1.4, 2.8),
        color: Math.random() < 0.5 ? "#67e8f9" : "#818cf8",
      });
    }
  } else {
    s.thrusting = false;
  }

  const drag = Math.max(0, 1 - SHIP_DRAG * dt);
  s.vx *= drag;
  s.vy *= drag;
  const speed = Math.hypot(s.vx, s.vy);
  if (speed > SHIP_MAX_SPEED) {
    s.vx = (s.vx / speed) * SHIP_MAX_SPEED;
    s.vy = (s.vy / speed) * SHIP_MAX_SPEED;
  }

  if (speed > 8) s.angle = Math.atan2(s.vy, s.vx);
  s.x += s.vx * dt;
  s.y += s.vy * dt;

  if (s.x < SHIP_RADIUS) {
    s.x = SHIP_RADIUS;
    s.vx = Math.abs(s.vx) * 0.65;
  } else if (s.x > W - SHIP_RADIUS) {
    s.x = W - SHIP_RADIUS;
    s.vx = -Math.abs(s.vx) * 0.65;
  }
  if (s.y < SHIP_RADIUS) {
    s.y = SHIP_RADIUS;
    s.vy = Math.abs(s.vy) * 0.65;
  } else if (s.y > H - SHIP_RADIUS) {
    s.y = H - SHIP_RADIUS;
    s.vy = -Math.abs(s.vy) * 0.65;
  }

  g.spawnTimer -= dt;
  const spawnInterval = Math.max(0.5, 2.2 / ramp);
  const maxAsteroids = Math.floor(5 + ramp * 3);
  if (g.spawnTimer <= 0 && g.asteroids.length < maxAsteroids) {
    g.asteroids.push(makeAsteroid(ramp));
    g.spawnTimer = spawnInterval;
  }

  const desiredOrbs = Math.min(2 + Math.floor(g.elapsed / 30), 5);
  g.orbTimer -= dt;
  if (g.orbs.length < desiredOrbs && g.orbTimer <= 0) {
    g.orbs.push(makeOrb());
    g.orbTimer = 0.8;
  }

  for (let i = g.asteroids.length - 1; i >= 0; i--) {
    const a = g.asteroids[i];
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rot += a.rotSpeed * dt;
    const pad = a.r;
    if (a.x < pad && a.vx < 0) a.vx = -a.vx;
    if (a.x > W - pad && a.vx > 0) a.vx = -a.vx;
    if (a.y < pad && a.vy < 0) a.vy = -a.vy;
    if (a.y > H - pad && a.vy > 0) a.vy = -a.vy;
    a.x = Math.max(pad, Math.min(W - pad, a.x));
    a.y = Math.max(pad, Math.min(H - pad, a.y));

    if (
      s.invuln <= 0 &&
      Math.hypot(a.x - s.x, a.y - s.y) < a.r * 0.85 + SHIP_RADIUS
    ) {
      s.lives -= 1;
      s.invuln = INVULN_TIME;
      g.shake = 14;
      burst(g.particles, s.x, s.y, 34, ["#fb7185", "#f59e0b", "#fde68a", "#ffffff"], 340);
      a.vx *= -0.6;
      a.vy *= -0.6;
      if (s.lives <= 0) {
        burst(g.particles, s.x, s.y, 60, ["#67e8f9", "#818cf8", "#ffffff"], 420);
        onDeath();
        return;
      }
    }
  }

  for (let i = g.orbs.length - 1; i >= 0; i--) {
    const o = g.orbs[i];
    o.phase += dt * 3;
    if (Math.hypot(o.x - s.x, o.y - s.y) < 22 + SHIP_RADIUS) {
      g.orbs.splice(i, 1);
      g.orbTimer = 0.5;
      g.score += 25;
      burst(g.particles, o.x, o.y, 16, ["#67e8f9", "#a5f3fc", "#ffffff"], 220);
    }
  }

  updateParticles(g, dt);
  g.shake = Math.max(0, g.shake - dt * 40);
}

function updateIdle(g: GameState, dt: number) {
  g.stars.forEach((star) => {
    star.tw += dt;
  });
  for (const a of g.asteroids) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rot += a.rotSpeed * dt;
    const pad = a.r;
    if (a.x < pad && a.vx < 0) a.vx = -a.vx;
    if (a.x > W - pad && a.vx > 0) a.vx = -a.vx;
    if (a.y < pad && a.vy < 0) a.vy = -a.vy;
    if (a.y > H - pad && a.vy > 0) a.vy = -a.vy;
  }
  if (g.asteroids.length < 4) {
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      g.asteroids.push(makeAsteroid(0.8));
      g.spawnTimer = 1.5;
    }
  }
  updateParticles(g, dt);
  g.shake = Math.max(0, g.shake - dt * 40);
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

  const bg = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.7);
  bg.addColorStop(0, "#0b1224");
  bg.addColorStop(1, "#05070f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (const star of g.stars) {
    const alpha = 0.25 + 0.55 * Math.abs(Math.sin(t * star.speed + star.tw));
    ctx.beginPath();
    ctx.fillStyle = `rgba(186, 230, 253, ${alpha})`;
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (g.shake > 0) {
    ctx.translate(rand(-g.shake, g.shake) * 0.4, rand(-g.shake, g.shake) * 0.4);
  }

  drawBorder(ctx);

  for (const o of g.orbs) drawOrb(ctx, o, t);
  for (const a of g.asteroids) drawAsteroid(ctx, a);
  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (phase === "playing" || phase === "paused" || phase === "gameover") {
    if (phase !== "gameover" || g.ship.lives > 0) {
      drawShip(ctx, g.ship, t);
    }
  }

  if (phase === "playing" || phase === "paused") {
    drawHud(ctx, g);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawBorder(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.22)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(56, 189, 248, 0.5)";
  ctx.shadowBlur = 18;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.restore();
}

function drawShip(ctx: CanvasRenderingContext2D, s: Ship, t: number) {
  const blinking = s.invuln > 0 && Math.floor(t * 10) % 2 === 0;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle + Math.PI / 2);

  if (s.thrusting) {
    const len = rand(14, 26);
    const flame = ctx.createLinearGradient(0, 10, 0, 10 + len);
    flame.addColorStop(0, "rgba(253, 224, 71, 0.95)");
    flame.addColorStop(0.5, "rgba(251, 146, 60, 0.7)");
    flame.addColorStop(1, "rgba(239, 68, 68, 0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-5, 10);
    ctx.lineTo(5, 10);
    ctx.lineTo(0, 10 + len);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = blinking ? 0.35 : 1;
  ctx.shadowColor = "rgba(103, 232, 249, 0.9)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#0e2a3d";
  ctx.strokeStyle = "#67e8f9";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(11, 10);
  ctx.lineTo(0, 4);
  ctx.lineTo(-11, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 8;
  ctx.fillStyle = "#a5f3fc";
  ctx.beginPath();
  ctx.arc(0, -3, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAsteroid(ctx: CanvasRenderingContext2D, a: Asteroid) {
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.rot);
  ctx.beginPath();
  a.verts.forEach((v, i) => {
    const x = Math.cos(v.a) * a.r * v.d;
    const y = Math.sin(v.a) * a.r * v.d;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  const grad = ctx.createLinearGradient(-a.r, -a.r, a.r, a.r);
  grad.addColorStop(0, "#4b5563");
  grad.addColorStop(1, "#1f2937");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
  for (const c of a.craters) {
    ctx.beginPath();
    ctx.arc(
      Math.cos(c.a) * a.r * c.d,
      Math.sin(c.a) * a.r * c.d,
      c.r,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawOrb(ctx: CanvasRenderingContext2D, o: Orb, t: number) {
  const pulse = 1 + Math.sin(o.phase + t * 2) * 0.15;
  const r = 9 * pulse;
  const glow = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * 3.2);
  glow.addColorStop(0, "rgba(165, 243, 252, 0.95)");
  glow.addColorStop(0.35, "rgba(34, 211, 238, 0.55)");
  glow.addColorStop(1, "rgba(34, 211, 238, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(o.x, o.y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ecfeff";
  ctx.beginPath();
  ctx.arc(o.x, o.y, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawHud(ctx: CanvasRenderingContext2D, g: GameState) {
  ctx.save();
  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "left";
  ctx.fillText(`SCORE ${Math.floor(g.score)}`, 22, 38);

  for (let i = 0; i < g.ship.lives; i++) {
    const x = W - 30 - i * 26;
    ctx.save();
    ctx.translate(x, 30);
    ctx.scale(0.75, 0.75);
    ctx.fillStyle = "#0e2a3d";
    ctx.strokeStyle = "#67e8f9";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(11, 10);
    ctx.lineTo(0, 4);
    ctx.lineTo(-11, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
