import Link from "next/link";

const games = [
  {
    href: "/games/space-arena",
    name: "Space Arena",
    description: "Fly a rocket, collect energy orbs, dodge asteroids.",
    accent: "group-hover:border-cyan-400 dark:group-hover:border-cyan-500",
    arrow: "group-hover:text-cyan-400",
  },
  {
    href: "/games/bumper-arena",
    name: "Bumper Arena",
    description: "Ricochet your orb and shove your rival into the spikes.",
    accent: "group-hover:border-fuchsia-400 dark:group-hover:border-fuchsia-500",
    arrow: "group-hover:text-fuchsia-400",
  },
  {
    href: "/games/corridor-run",
    name: "Corridor Run",
    description: "Cockpit driving through a tight corridor of twists and turns.",
    accent: "group-hover:border-emerald-400 dark:group-hover:border-emerald-500",
    arrow: "group-hover:text-emerald-400",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Plarena
        </h1>
        <p className="mt-3 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          A small arena of browser games.
        </p>

        <div className="mt-10 grid gap-4">
          {games.map((game) => (
            <Link
              key={game.href}
              href={game.href}
              className={`group flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-6 transition-colors dark:border-zinc-800 dark:bg-zinc-900 ${game.accent}`}
            >
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {game.name}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {game.description}
                </p>
              </div>
              <span
                className={`text-2xl text-zinc-400 transition-transform group-hover:translate-x-1 ${game.arrow}`}
              >
                →
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
