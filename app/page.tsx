import type { Metadata } from "next";
import ScrollScene from "./components/ScrollScene";

export const metadata: Metadata = {
  title: "GDG Cloud Mumbai — Cinematic Scrollytelling",
  description:
    "Experience Mumbai's transformation through a cinematic scroll-driven journey. GDG Cloud Mumbai — where builders gather.",
  keywords: [
    "GDG Cloud Mumbai",
    "Google Developer Groups",
    "Mumbai developers",
    "cloud community",
    "scrollytelling",
  ],
  openGraph: {
    title: "GDG Cloud Mumbai — Cinematic Scrollytelling",
    description:
      "Experience Mumbai's transformation through a cinematic scroll-driven journey.",
    type: "website",
  },
};

export default function Home() {
  return (
    <main id="main-content">
      <ScrollScene />
    </main>
  );
}
