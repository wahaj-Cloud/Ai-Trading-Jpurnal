import type { MetadataRoute } from "next";

/** Lets phones install WickMentor to the home screen with its own icon and colours. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WickMentor · AI trading journal and coach",
    short_name: "WickMentor",
    description: "Your AI trading journal and coach.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#050819",
    theme_color: "#050819",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
