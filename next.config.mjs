/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Docker image builds a self-contained server; `npm start` uses the regular one.
  output: process.env.CLAYFORM_STANDALONE ? "standalone" : undefined,
  poweredByHeader: false,
  // The vendored OPENCTRL MCP kit uses ESM-style "./file.js" imports for its TypeScript sources.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  async headers() {
    return [
      {
        // Admin pages must never be framed. Public forms (/f/*) can be embedded anywhere.
        source: "/((?!f/|embed.js).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
