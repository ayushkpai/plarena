import type { Metadata } from "next";
import LunarLander from "@/game/lunar-lander";

export const metadata: Metadata = {
  title: "Lunar Lander — Plarena",
  description:
    "Guide your lander down to a lit pad: manage fuel, gravity and thrust for a soft, upright touchdown.",
};

export default function LunarLanderPage() {
  return <LunarLander />;
}
