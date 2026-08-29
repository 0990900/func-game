import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The rules core lives outside this root; Vite must be allowed to read it.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [repoRoot] },
    // Dev only, and this server is meant to be reachable from a phone or
    // another machine on the LAN — by hostname, Tailscale name or IP.
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
