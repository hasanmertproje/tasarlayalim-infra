@@
-import { TASO_PRIMARY_SCREENS, useTasoNavigation, type TasoScreen } from './navigation';
+import { TASO_PRIMARY_SCREENS, useTasoNavigation, type TasoScreen } from './navigation';
+import AnimeScreen from './AnimeScreen';
@@
-  function renderScreen() {
-    switch (activeNav) {
-      case 'Projects': return <ProjectsScreen />;
-      case 'Tasks': return <TasksScreen />;
-      case 'Approvals': return <ApprovalsScreen />;
-      case 'Deployments': return <DeploymentsScreen />;
-      case 'AI Agents': return <PlaceholderScreen title="AI Agents" description="Taso executor ve provider çalışma durumlarının yönetim yüzeyi." />;
-      case 'Knowledge': return <PlaceholderScreen title="Knowledge" description="Workspace kararları, runbook ve proje bağlamı için ayrılmış bilgi yüzeyi." />;
-      case 'Integrations': return <PlaceholderScreen title="Integrations" description="GitHub, Coolify ve bildirim entegrasyonlarının doğrulanmış durum yüzeyi." />;
-      case 'Monitoring': return <InfrastructureScreen />;
-      case 'Settings': return <PlaceholderScreen title="Settings" description="Taso çalışma politikaları ve yönetici ayarları için ürün yüzeyi." />;
-      case 'Notifications': return <NotificationsScreen />;
-      case 'Infrastructure': return <InfrastructureScreen />;
-      default: return <CommandCenter />;
-    }
-  }
+  function renderScreen() {
+    switch (activeNav) {
+      case 'Projects': return <ProjectsScreen />;
+      case 'Tasks': return <TasksScreen />;
+      case 'Approvals': return <ApprovalsScreen />;
+      case 'Deployments': return <DeploymentsScreen />;
+      case 'AI Agents': return <PlaceholderScreen title="AI Agents" description="Taso executor ve provider çalışma durumlarının yönetim yüzeyi." />;
+      case 'Knowledge': return <PlaceholderScreen title="Knowledge" description="Workspace kararları, runbook ve proje bağlamı için ayrılmış bilgi yüzeyi." />;
+      case 'Integrations': return <PlaceholderScreen title="Integrations" description="GitHub, Coolify ve bildirim entegrasyonlarının doğrulanmış durum yüzeyi." />;
+      case 'Monitoring': return <InfrastructureScreen />;
+      case 'Settings': return <PlaceholderScreen title="Settings" description="Taso çalışma politikaları ve yönetici ayarları için ürün yüzeyi." />;
+      case 'Notifications': return <NotificationsScreen />;
+      case 'Infrastructure': return <InfrastructureScreen />;
+      case 'Anime': return <AnimeScreen />;
+      default: return <CommandCenter />;
+    }
+  }
@@
-        <nav className="main-nav" aria-label="Ana navigasyon">{navItems.map((item, index) => <button className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => switchNav(item)} key={item} type="button" aria-current={activeNav === item ? 'page' : undefined}><span className="nav-index">{String(index + 1).padStart(2, '0')}</span><span>{item}</span></button>)}</nav>
+        <nav className="main-nav" aria-label="Ana navigasyon">{navItems.map((item, index) => <button className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => switchNav(item)} key={item} type="button" aria-current={activeNav === item ? 'page' : undefined}><span className="nav-index">{String(index + 1).padStart(2, '0')}</span><span>{item}</span></button>)}</nav>
+        <button className={activeNav === 'Anime' ? 'nav-item active' : 'nav-item'} onClick={() => switchNav('Anime')} type="button" aria-current={activeNav === 'Anime' ? 'page' : undefined} style={{marginTop:'8px'}}>
+          <span className="nav-index">99</span><span>Anime</span>
+        </button>
*** End Patch ***