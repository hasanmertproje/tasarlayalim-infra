import { AuthService, registerAuthRoutes } from './auth.js';
import { buildServer } from './server.js';
import { registerLocalVoiceRoutes } from './voice-local-routes.js';
import { registerVoiceRealtimeRoutes } from './voice-realtime-routes.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const app = buildServer();
const auth = new AuthService();
registerAuthRoutes(app, auth);
registerVoiceRealtimeRoutes(app);
registerLocalVoiceRoutes(app);

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
