import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";

import "@/app/globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mochi — Context that can act",
  description:
    "A screenshot-driven universal form assistant with three strategies and three levels of control.",
  metadataBase: new URL("https://mochi-overlay.vercel.app"),
  openGraph: {
    title: "Mochi — Show it. Let it act.",
    description:
      "Drop a screenshot, get three grounded routes, and let a tiny sidekick fill the page.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${instrument.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

