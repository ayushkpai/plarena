"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "menu" | "playing" | "paused" | "gameover";
type Mode = "solo" | "duo";
type Winner = "p1" | "p2" | null;

const W = 960;
const H = 600;

const ORB_RADIUS = 19;
const ACCEL = 1000;
const MAX_SPEED = 470;
const DRAG = 1.9;
const WALL_RESTITUTION = 0.92;

const HP_MAX = 100;
const HAZARD_DPS = 44;
const HAZARD_RADIUS = 30;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  hue: string;
  glow: string;
  name: string;
}

interface Hazard {
  x: number;
  y: number;
  rot: number;
  rotSpeed: number;
  spikes: number;
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
  p1: Orb;
  p2: Orb;
  hazards: Hazard[];
  particles: Particle[];
  stars: Star[];
  shake: number;
  countdown: number;
}

const HAZARD_SPOTS: { x: number; y: number }[] = [
  { x: W * 0.5, y: H * 0.16 },
  { x: W * 0.5, y: H * 0.84 },
  { x: W * 0.16, y: H * 0.5 },
  { x: W * 0.84, y: H * 0.5 },
];

function makeStars(): Star[] {
  return Array.from({ length: 150 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: rand(0.4, 1.6),
    tw: rand(0, Math.PI * 2),
    speed: rand(0.2, 0.7),
  }));
}

function makeOrb(x: number, y: number, hue: string, glow: string, name: string): Orb {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: hue === "#22d3ee" ? 0 : Math.PI,
    hp: HP_MAX,
    hue,
    glow,
    name,
  };
}

function makeState(): GameState {
  return {
    p1: makeOrb(W * 0.24, H * 0.5, "#22d3ee", "rgba(34, 211, 238, 0.85)", "P1"),
    p2: makeOrb(W * 0.76, H * 0.5, "#fb7185", "rgba(251, 113, 133, 0.85)", "P2"),
    hazards: HAZARD_SPOTS.map((s) => ({
      x: s.x,
      y: s.y,
      rot: rand(0, Math.PI * 2),
      rotSpeed: rand(0.4, 1) * (Math.random() < 0.5 ? -1 : 1),
      spikes: 10,
    })),
    particles: [],
    stars: makeStars(),
    shake: 0,
    countdown: 1.6,
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
      life: rand(0.3, 0.8),
      maxLife: 0.8,
      size: rand(1.5, 3.6),
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
}

export default function BumperArena() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<Phase>("menu");
  const modeRef = useRef<Mode>("solo");
  const gameRef = useRef<GameState | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<Mode>("solo");
  const [winner, setWinner] = useState<Winner>(null);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const startGame = useCallback(
    (m: Mode) => {
      modeRef.current = m;
      setMode(m);
      setWinner(null);
      gameRef.current = makeState();
      setPhaseBoth("playing");
    },
    [setPhaseBoth],
  );

  const finish = useCallback(
    (w: Winner) => {
      setWinner(w);
      setPhaseBoth("gameover");
    },
    [setPhaseBoth],
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "enter"].includes(k)) {
        e.preventDefault();
      }
      keysRef.current.add(k);

      const current = phaseRef.current;

      if (current === "menu") {
        if (k === " " || k === "enter" || k === "1") startGame("solo");
        else if (k === "2") startGame("duo");
      } else if (current === "gameover") {
        if (k === "r" || k === " " || k === "enter") startGame(modeRef.current);
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
      const g = gameRef.current;
      const current = phaseRef.current;

      if (!g) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#05070f";
        ctx.fillRect(0, 0, W, H);
        return;
      }

      if (current === "playing") {
        update(g, dt, keysRef.current, modeRef.current, finish);
      } else {
        updateIdle(g, dt);
      }
      draw(ctx, g, dpr, now / 1000, current, modeRef.current);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [finish]);

  const onPointerDown = () => {
    if (phaseRef.current === "menu") startGame("solo");
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
            {phase === "menu" ? "" : mode === "solo" ? "SOLO" : "2P"}
          </span>
        </div>

        <div className="group relative aspect-[8/5] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-[#05070f] shadow-2xl shadow-rose-500/5">
          <canvas ref={canvasRef} className="h-full w-full" onPointerDown={onPointerDown} />

          {phase === "menu" && (
            <Overlay>
              <h1 className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-rose-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
                Bumper Arena
              </h1>
              <p className="max-w-md text-center text-sm leading-6 text-zinc-400">
                Bump your rival into the spikes. Fast hits shove harder — dodge the
                hazards and drain their health to win.
              </p>
              <div className="flex flex-col items-center gap-1 text-center text-xs text-zinc-500">
                <p>
                  Player 1{" "}
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
                    WASD
                  </span>
                </p>
                <p>
                  Player 2{" "}
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
                    Arrows
                  </span>
                </p>
              </div>
              <div className="flex gap-3">
                <StartButton onClick={() => startGame("solo")}>
                  Play vs CPU
                </StartButton>
                <StartButton variant="ghost" onClick={() => startGame("duo")}>
                  2 Players
                </StartButton>
              </div>
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
              <h2
                className="text-4xl font-bold"
                style={{ color: winner === "p1" ? "#22d3ee" : "#fb7185" }}
              >
                {winner === "p1"
                  ? "Player 1 Wins"
                  : mode === "solo"
                    ? "CPU Wins"
                    : "Player 2 Wins"}
              </h2>
              <div className="flex gap-3">
                <StartButton onClick={() => startGame(mode)}>Rematch</StartButton>
                <Link
                  href="/"
                  className="rounded-full border border-zinc-700 px-6 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  Menu
                </Link>
              </div>
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

function StartButton({
  children,
  onClick,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "solid" | "ghost";
}) {
  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-full border border-zinc-700 px-7 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-7 py-2.5 text-sm font-semibold text-black shadow-lg shadow-fuchsia-500/20 transition-transform hover:scale-105 active:scale-95"
    >
      {children}
    </button>
  );
}

function update(
  g: GameState,
  dt: number,
  keys: Set<string>,
  mode: Mode,
  onFinish: (w: Winner) => void,
) {
  g.shake = Math.max(0, g.shake - dt * 40);
  g.countdown = Math.max(0, g.countdown - dt);
  const frozen = g.countdown > 0;

  g.hazards.forEach((h) => (h.rot += h.rotSpeed * dt));

  if (!frozen) {
    applyInput(g.p1, dt, keys);
    if (mode === "solo") applyAi(g, g.p2, g.p1, dt);
    else applyInput(g.p2, dt, keys, "arrow");
  }

  const drag = Math.max(0, 1 - DRAG * dt);
  [g.p1, g.p2].forEach((orb) => {
    orb.vx *= drag;
    orb.vy *= drag;
    const sp = Math.hypot(orb.vx, orb.vy);
    if (sp > MAX_SPEED) {
      orb.vx = (orb.vx / sp) * MAX_SPEED;
      orb.vy = (orb.vy / sp) * MAX_SPEED;
    }
    if (sp > 14) orb.angle = Math.atan2(orb.vy, orb.vx);
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;
    bounceWalls(orb);
  });

  if (!frozen) {
    collideOrbs(g);
  }

  for (const orb of [g.p1, g.p2]) {
    for (const h of g.hazards) {
      const d = Math.hypot(orb.x - h.x, orb.y - h.y);
      const min = HAZARD_RADIUS + ORB_RADIUS;
      if (d < min) {
        const nx = (orb.x - h.x) / (d || 1);
        const ny = (orb.y - h.y) / (d || 1);
        orb.x = h.x + nx * min;
        orb.y = h.y + ny * min;
        const vn = orb.vx * nx + orb.vy * ny;
        if (vn < 0) {
          orb.vx -= (1 + WALL_RESTITUTION) * vn * nx;
          orb.vy -= (1 + WALL_RESTITUTION) * vn * ny;
        }
        orb.vx += nx * 120;
        orb.vy += ny * 120;
        if (!frozen) {
          orb.hp = Math.max(0, orb.hp - HAZARD_DPS * dt);
          g.shake = Math.max(g.shake, 4);
          if (Math.random() < 0.5) {
            burst(g.particles, orb.x, orb.y, 2, ["#f97316", "#facc15", "#ffffff"], 180);
          }
        }
      }
    }
  }

  if (!frozen) {
    if (g.p1.hp <= 0 || g.p2.hp <= 0) {
      const w: Winner = g.p1.hp <= 0 ? "p2" : "p1";
      const loser = g.p1.hp <= 0 ? g.p1 : g.p2;
      burst(g.particles, loser.x, loser.y, 50, [loser.hue, "#ffffff"], 380);
      g.shake = 16;
      onFinish(w);
      return;
    }
  }

  updateParticles(g, dt);
}

function applyInput(orb: Orb, dt: number, keys: Set<string>, scheme: "wasd" | "arrow" = "wasd") {
  let ax = 0;
  let ay = 0;
  if (scheme === "wasd") {
    if (keys.has("w")) ay -= 1;
    if (keys.has("s")) ay += 1;
    if (keys.has("a")) ax -= 1;
    if (keys.has("d")) ax += 1;
  } else {
    if (keys.has("arrowup")) ay -= 1;
    if (keys.has("arrowdown")) ay += 1;
    if (keys.has("arrowleft")) ax -= 1;
    if (keys.has("arrowright")) ax += 1;
  }
  const mag = Math.hypot(ax, ay);
  if (mag > 0) {
    orb.vx += (ax / mag) * ACCEL * dt;
    orb.vy += (ay / mag) * ACCEL * dt;
  }
}

function applyAi(g: GameState, ai: Orb, target: Orb, dt: number) {
  let ax = target.x - ai.x;
  let ay = target.y - ai.y;
  const dist = Math.hypot(ax, ay) || 1;
  ax /= dist;
  ay /= dist;

  for (const h of g.hazards) {
    const hx = ai.x - h.x;
    const hy = ai.y - h.y;
    const hd = Math.hypot(hx, hy) || 1;
    const danger = HAZARD_RADIUS + 95;
    if (hd < danger) {
      const push = (danger - hd) / danger;
      ax += (hx / hd) * push * 2.2;
      ay += (hy / hd) * push * 2.2;
    }
  }

  const mag = Math.hypot(ax, ay) || 1;
  ai.vx += (ax / mag) * ACCEL * 0.92 * dt;
  ai.vy += (ay / mag) * ACCEL * 0.92 * dt;
}

function bounceWalls(orb: Orb) {
  if (orb.x < ORB_RADIUS) {
    orb.x = ORB_RADIUS;
    orb.vx = Math.abs(orb.vx) * WALL_RESTITUTION;
  } else if (orb.x > W - ORB_RADIUS) {
    orb.x = W - ORB_RADIUS;
    orb.vx = -Math.abs(orb.vx) * WALL_RESTITUTION;
  }
  if (orb.y < ORB_RADIUS) {
    orb.y = ORB_RADIUS;
    orb.vy = Math.abs(orb.vy) * WALL_RESTITUTION;
  } else if (orb.y > H - ORB_RADIUS) {
    orb.y = H - ORB_RADIUS;
    orb.vy = -Math.abs(orb.vy) * WALL_RESTITUTION;
  }
}

function collideOrbs(g: GameState) {
  const a = g.p1;
  const b = g.p2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const min = ORB_RADIUS * 2;
  if (dist >= min) return;

  const nx = dx / dist;
  const ny = dy / dist;

  const overlap = min - dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;
  if (velAlongNormal > 0) return;

  const restitution = 1.05;
  const j = (-(1 + restitution) * velAlongNormal) / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;

  const impact = Math.abs(velAlongNormal);
  if (impact > 40) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    burst(g.particles, mx, my, Math.min(20, Math.floor(impact / 12)), ["#ffffff", "#e2e8f0", "#fde68a"], impact * 1.6);
    g.shake = Math.max(g.shake, Math.min(12, impact / 30));
  }
}

function updateIdle(g: GameState, dt: number) {
  g.stars.forEach((s) => (s.tw += dt));
  g.hazards.forEach((h) => (h.rot += h.rotSpeed * dt));
  updateParticles(g, dt);
  g.shake = Math.max(0, g.shake - dt * 40);
}

function updateParticles(g: GameState, dt: number) {
  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.95;
    p.vy *= 0.95;
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
  mode: Mode,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.7);
  bg.addColorStop(0, "#0c1020");
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
    ctx.save();
    ctx.translate(rand(-g.shake, g.shake) * 0.35, rand(-g.shake, g.shake) * 0.35);
  }

  drawArena(ctx);
  for (const h of g.hazards) drawHazard(ctx, h, t);

  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (phase !== "menu") {
    drawOrb(ctx, g.p2, t, mode === "solo" ? "CPU" : "P2");
    drawOrb(ctx, g.p1, t, "P1");
  }

  if (g.shake > 0) ctx.restore();

  if (phase === "playing" || phase === "paused" || phase === "gameover") {
    drawHud(ctx, g, mode);
  }

  if (phase === "playing" && g.countdown > 0) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
    ctx.font = "700 64px ui-monospace, Menlo, monospace";
    ctx.fillText(g.countdown > 0.8 ? "READY" : "GO!", W / 2, H / 2 + 22);
    ctx.restore();
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawArena(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.setLineDash([10, 14]);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
  ctx.beginPath();
  ctx.moveTo(W / 2, 20);
  ctx.lineTo(W / 2, H - 20);
  ctx.stroke();
  ctx.restore();
}

function drawHazard(ctx: CanvasRenderingContext2D, h: Hazard, t: number) {
  const pulse = 1 + Math.sin(t * 3 + h.rot) * 0.06;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(h.rot);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, HAZARD_RADIUS * 2.4);
  glow.addColorStop(0, "rgba(249, 115, 22, 0.4)");
  glow.addColorStop(1, "rgba(249, 115, 22, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, HAZARD_RADIUS * 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < h.spikes * 2; i++) {
    const r = (i % 2 === 0 ? HAZARD_RADIUS : HAZARD_RADIUS * 0.62) * pulse;
    const a = (i / (h.spikes * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createLinearGradient(-HAZARD_RADIUS, -HAZARD_RADIUS, HAZARD_RADIUS, HAZARD_RADIUS);
  grad.addColorStop(0, "#fb923c");
  grad.addColorStop(1, "#b91c1c");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#fca5a5";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#7f1d1d";
  ctx.beginPath();
  ctx.arc(0, 0, HAZARD_RADIUS * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawOrb(ctx: CanvasRenderingContext2D, orb: Orb, t: number, label: string) {
  const hpFrac = Math.max(0, orb.hp) / HP_MAX;
  ctx.save();
  ctx.translate(orb.x, orb.y);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, ORB_RADIUS * 3);
  glow.addColorStop(0, orb.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, ORB_RADIUS * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = orb.glow;
  ctx.shadowBlur = 20 + hpFrac * 12;
  ctx.fillStyle = "#0b1524";
  ctx.strokeStyle = orb.hue;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, ORB_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.rotate(orb.angle);
  ctx.shadowBlur = 0;
  ctx.fillStyle = orb.hue;
  ctx.beginPath();
  ctx.moveTo(ORB_RADIUS - 4, 0);
  ctx.lineTo(ORB_RADIUS - 13, 7);
  ctx.lineTo(ORB_RADIUS - 13, -7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(226, 232, 240, 0.65)";
  ctx.font = "600 12px ui-monospace, Menlo, monospace";
  ctx.fillText(label, orb.x, orb.y - ORB_RADIUS - 12);
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, g: GameState, mode: Mode) {
  ctx.save();
  const barW = 320;
  const barH = 16;

  drawBar(ctx, 24, 26, barW, barH, g.p1.hp, "#22d3ee", "P1", false);
  drawBar(
    ctx,
    W - 24 - barW,
    26,
    barW,
    barH,
    g.p2.hp,
    "#fb7185",
    mode === "solo" ? "CPU" : "P2",
    true,
  );

  ctx.restore();
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  hp: number,
  color: string,
  label: string,
  right: boolean,
) {
  const frac = Math.max(0, hp) / HP_MAX;
  ctx.save();
  ctx.fillStyle = "rgba(148,163,184,0.15)";
  ctx.fillRect(x, y, w, h);
  const fillW = w * frac;
  const fx = right ? x + w - fillW : x;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillRect(fx, y, fillW, h);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(226,232,240,0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "700 14px ui-monospace, Menlo, monospace";
  ctx.textAlign = right ? "right" : "left";
  ctx.fillText(label, right ? x + w : x, y - 8);
  ctx.restore();
}
