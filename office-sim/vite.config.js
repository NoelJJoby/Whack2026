import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    build: {
        // three.js alone is about 1 MB minified and cannot be split further; the app code stays well under this.
        chunkSizeWarningLimit: 1100,
        rollupOptions: {
            output: {
                // Keep the 3D renderer in its own cacheable chunk, separate from the Office3D scene code.
                manualChunks: function (id) {
                    if (id.includes('node_modules') && /\/node_modules\/(\.pnpm\/[^/]*\/node_modules\/)?(three|@react-three\/(fiber|drei))\//.test(id))
                        return 'three';
                    return undefined;
                },
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3010',
                changeOrigin: true,
            },
        },
    },
});
