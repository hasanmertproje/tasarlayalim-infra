import { buildServer } from './server.js';
import { registerVoiceRealtimeRoutes } from './voice-realtime-routes.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const app = buildServer();
registerVoiceRealtimeRoutes(app);

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
