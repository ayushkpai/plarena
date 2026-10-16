import type { Metadata } from "next";
import BumperArena from "@/game/bumper-arena";

export const metadata: Metadata = {
  title: "Bumper Arena — Plarena",
  description:
    "Ricochet your orb around the arena and shove your rival into the spikes.",
};

export default function BumperArenaPage() {
  return <BumperArena />;
}
