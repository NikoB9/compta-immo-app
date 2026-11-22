import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Compta Immo",
    short_name: "Compta Immo",
    description: "Un espace privé pour votre gestion immobilière.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f4ef",
    theme_color: "#193c35",
    icons: [
      { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
