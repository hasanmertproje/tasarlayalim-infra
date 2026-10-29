import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';
export default defineConfig(({mode})=>({
 plugins:[react(),...(mode==='offline'?[viteSingleFile()]:[])],
 base:'./',
 build:{sourcemap:false,chunkSizeWarningLimit:700}
}));