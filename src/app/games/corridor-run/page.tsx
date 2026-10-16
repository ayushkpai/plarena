import type { Metadata } from "next";
import CorridorRun from "@/game/corridor-run";

export const metadata: Metadata = {
  title: "Corridor Run — Plarena",
  description:
    "Cockpit-view driving through a cramped corridor of twists and turns. Reach the finish without touching the walls.",
};

export default function CorridorRunPage() {
  return <CorridorRun />;
}
