import type { Metadata } from "next";
import SpaceArena from "@/game/space-arena";

export const metadata: Metadata = {
  title: "Space Arena — Plarena",
  description:
    "Pilot your rocket through the arena: collect energy orbs and dodge drifting asteroids.",
};

export default function SpaceArenaPage() {
  return <SpaceArena />;
}
