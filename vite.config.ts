import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build work from any sub-path (GitHub Pages project sites, Netlify, file hosting).
export default defineConfig({
  base: './',
  plugins: [react()],
});
