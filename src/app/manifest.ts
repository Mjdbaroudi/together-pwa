import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Together — Just You and Me",
    short_name: "Together",
    description: "Private couple chat, memories, voice notes and important moments.",
    start_url: "/login",
    display: "standalone",
    background_color: "#FAF9F7",
    theme_color: "#F7F6F3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
