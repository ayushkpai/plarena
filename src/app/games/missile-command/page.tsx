import type { Metadata } from "next";
import MissileCommand from "@/game/missile-command";

export const metadata: Metadata = {
  title: "Missile Command — Plarena",
  description:
    "Defend your cities from the missile rain. Launch interceptors to detonate the incoming warheads.",
};

export default function MissileCommandPage() {
  return <MissileCommand />;
}
