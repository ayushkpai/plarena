import Link from "next/link";

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
          <Link
            href="/games/space-arena"
            className="group flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-6 transition-colors hover:border-cyan-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-cyan-500"
          >
            <div>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Space Arena
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Fly a rocket, collect energy orbs, dodge asteroids.
              </p>
            </div>
            <span className="text-2xl text-zinc-400 transition-transform group-hover:translate-x-1 group-hover:text-cyan-400">
              →
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
