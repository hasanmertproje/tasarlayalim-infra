import { registerAuthRoutes } from './auth.js';
import { AuthServiceV18 } from './auth-v18.js';
import { registerBrowserOperatorRoutes } from './browser-operator-routes.js';
import { registerControlPlaneRoutes } from './control-plane-routes.js';
import { IdentityStore } from './identity-store.js';
import { registerRbacRoutes } from './rbac-routes.js';
import { buildServer } from './server.js';
import { registerLocalVoiceRoutes } from './voice-local-routes.js';
import { registerVerificationRoutes } from './verification-routes.js';
import { registerVisualQaRoutes } from './visual-qa.js';
import { registerVoiceRealtimeRoutes } from './voice-realtime-routes.js';
import { registerWebResearchRoutes } from './web-research.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const app = buildServer();
const auth = new AuthServiceV18();
const identities = new IdentityStore(process.env.TASO_OWNER_EMAIL || '');
registerAuthRoutes(app, auth);
registerRbacRoutes(app, auth, identities);
registerControlPlaneRoutes(app, auth, identities);
registerVoiceRealtimeRoutes(app);
registerLocalVoiceRoutes(app);
registerWebResearchRoutes(app);
registerBrowserOperatorRoutes(app);
registerVisualQaRoutes(app);
registerVerificationRoutes(app);

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
