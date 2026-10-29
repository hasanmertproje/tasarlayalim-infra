# TASO NEXT / Signal Workbench — Design System M1

## Distinct product grammar
Admin is an operational signal board emphasizing queues, decisions, incident priority and source-backed status. Workspace emphasizes project identity, task ownership and editing surfaces. Both share layout tokens, not identical page cards.

## Palette
Ink background `#10171c`, slate rail `#131d22`, surface `#18232a`, tactile moss-action `#b8ec74`, verdigris semantic accent `#67c4b0`, amber for attention, red for risk. Light theme uses warm off-white and darker action ink. Avoid purple gradients, emoji icons, decorative SaaS charts and misleading production metrics.

## Component architecture
Custom SVG path icons with one coherent stroke, locally scoped forms, action/control tokens and route-specific layouts. One semantically focused Surface component rather than blindly reusing generic DomainPage. Nonfunctional external actions explicitly disabled.

## Mobile IA
Bottom dock for five high-frequency destinations, contextual drawer for rest, project-first hub, dedicated 3-tab mobile Studio (Layers/Canvas/Properties), constrained interaction header, independent Voice stage. Minimum tap targets generally 41–44px, with remaining accessibility audit pending.

## References screened
Tabler (MIT): strong responsive dashboard examples, but Bootstrap-based components and sample charts would flatten product identity. Mantine (MIT): well-maintained React primitives, optional future use for accessible compound inputs; not copied wholesale. Radix Primitives (MIT): later accessible behavior primitives. No external template copied, since TASO's dual-shell/navigation and editor layout require bespoke composition.