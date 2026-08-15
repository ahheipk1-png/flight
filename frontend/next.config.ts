import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: every page here is client components calling the
  // external FastAPI backend directly -- no route handlers, no
  // middleware -- so nothing needs a Node/edge server at request time.
  // Lets this ship as plain static files on Cloudflare Pages.
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
