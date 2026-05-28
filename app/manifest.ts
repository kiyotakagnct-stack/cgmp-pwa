import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CGMP",
    short_name: "CGMP",
    description: "CGMP PWA MVP",
    start_url: "/",
    display: "standalone",
    background_color: "#07111f",
    theme_color: "#0f172a",
    lang: "ja",
    icons: [],
  };
}
