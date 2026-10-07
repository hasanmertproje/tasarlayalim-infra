# Taso UI/UX v1 — Command Center

Taso is the AI-native operator interface for Tasarlayalım Dev Cloud. The UI must feel like a premium AI command center, but remain operationally clear, mobile-first, and safe.

## Product principles

1. Project-scoped by default. Reksa Reklam, Maria Çiçek, Growth OS, Yoncalı Doğan Apart and every future project are separate workspaces.
2. Voice and text are equal first-class inputs.
3. Taso is the visible coordinator; low-level agents remain behind the scenes unless the user opens details.
4. High-impact operations always surface explicit approval UI.
5. The UI must explain what happened, what is happening, what Taso did automatically, and what the user must do next.
6. Mobile is a primary interface, not a reduced desktop mode.
7. Visual direction: premium dark AI console, subtle Jarvis influence, no game-like HUD clutter.

## Information architecture

Global navigation:

- Command Center
- Projects
- Tasks
- Approvals
- Deployments
- Notifications
- Taso
- Infrastructure
- Settings

Project workspace navigation:

- Overview
- Taso
- Tasks
- Code
- Deployments
- Files
- Memory
- Activity
- Settings

## Screen 01 — Global Command Center

Purpose: show system state, active work, approvals and a fast entry point to Taso.

Primary zones:

- Taso status orb
- voice/text command input
- active missions
- approvals requiring attention
- recent deployments
- infrastructure health
- recent notifications

Hero states:

- IDLE
- LISTENING
- UNDERSTANDING
- PLANNING
- EXECUTING
- TESTING
- DEPLOYING
- WAITING_FOR_APPROVAL
- COMPLETED
- ERROR

The orb should use restrained motion: pulse, orbit, progress ring and waveform behavior according to state.

## Screen 02 — Projects

Each project card shows:

- project name
- production domain
- repository
- production health
- preview state
- active task count
- pending approvals
- last activity

Project cards must never blend project context. Opening one project changes the entire workspace context.

## Screen 03 — Project Overview

Header:

- project name
- project status
- current environment
- repository + default branch
- production URL
- preview count

Main content:

- project-specific Taso quick command
- current tasks
- deployment status
- latest activity
- known issues
- project memory summary

## Screen 04 — Taso Workspace

This is the primary interaction screen.

Desktop layout:

- left: project navigation
- center: Taso conversation and task execution timeline
- right: contextual mission panel

Mobile layout:

- full-screen conversation
- sticky project selector
- persistent hold-to-talk action
- bottom sheet for current mission details

Conversation messages may become structured mission cards when execution starts.

Example user command:

> Taso, Reksa Reklam hero alanını premiumlaştır. Mevcut backend'e dokunma. Test et ve preview çıkar.

Taso response should summarize:

- understood scope
- protected areas
- selected workflow
- whether approval will be required later

## Screen 05 — Voice / Talk to Taso

Two voice modes:

### Push-to-talk

Short commands and task creation.

### Live conversation

Continuous conversational session with:

- live waveform
- timer
- mute
- transcript toggle
- end call
- current project badge
- Taso state

Every voice session must be transcribed into the current project context. Voice input must never silently execute a HIGH_IMPACT action; the action becomes an approval request.

## Screen 06 — Tasks

Task card fields:

- task ID
- project
- title
- initiator
- active agent role
- status
- branch
- environment
- progress
- elapsed time
- retry count
- next expected state

Task lifecycle:

`queued -> planning -> running -> testing -> preview_ready -> completed`

Side states:

- waiting_approval
- failed
- cancelled

Task details show a human-readable execution timeline, not raw log spam by default.

## Screen 07 — Mission detail

Mission detail should answer five questions immediately:

1. What did I ask Taso to do?
2. What has Taso changed?
3. What checks have passed or failed?
4. Where can I preview the result?
5. Does Taso need anything from me?

Sections:

- objective
- scope and protected areas
- branch / commit
- execution steps
- tests
- preview
- changed files summary
- errors / retries
- approval requests
- audit trail

## Screen 08 — Approvals Center

High-impact operations include, at minimum:

- production deploy
- production migration
- destructive rollback
- database delete / reset
- domain transfer or destructive DNS changes
- secret / permission changes
- billing or paid provider activation

Approval cards display:

- project
- requested operation
- requester / Taso mission
- risk level
- reason
- CI/test status
- backup readiness if relevant
- affected environment
- approve
- reject
- request revision

No destructive or production-critical operation may be hidden behind a generic confirm dialog.

## Screen 09 — Deployments

Views:

- previews
- staging
- production
- failed deployments

Each deployment displays:

- project
- source branch
- commit
- target environment
- URL
- health status
- deploy duration
- triggered by
- related mission
- rollback availability

## Screen 10 — Notifications Center

Notification UX uses a standard Taso event format so screenshots remain understandable without extra context.

Required metadata:

- event type
- project
- task ID
- environment
- branch / commit when relevant
- current state
- automatic action taken
- user action required
- deep link

Example:

```
✅ TASO • PREVIEW READY

Project: Reksa Reklam
Task: RKS-0142
Branch: feature/reksa-premium-hero
Checks: 8/8 passed
Preview: ready
Next: Review → Approve
Event: PREVIEW-20261007-0142
```

Failure example:

```
❌ TASO • TASK BLOCKED

Project: Maria Çiçek
Task: MRC-0087
Stage: PHP tests
Failure: OrderServiceTest
Auto-fix: 1 attempt
Next: Human review required
Event: FAIL-20261007-0087
```

## Screen 11 — Project Memory

Project memory is explicit and reviewable.

Sections:

- business / brand context
- technical stack
- protected systems
- design decisions
- customer constraints
- known issues
- approved conventions
- recent decisions

Memory is project-scoped. Cross-project transfer must be explicit.

## Screen 12 — Activity Timeline

Every important event is recorded chronologically:

- user command
- task created
- branch created
- agent started
- commit created
- CI started
- tests passed / failed
- preview deployed
- approval requested
- production deployed

The default view is concise; raw logs are available behind an advanced view.

## Visual system

Direction:

- graphite / near-black surfaces
- translucent panels used sparingly
- thin luminous borders
- restrained cyan / electric blue / violet accents
- state colors reserved for status semantics
- high-contrast typography
- monospaced text only for technical metadata
- subtle background grid/noise
- soft depth, not exaggerated glassmorphism

Avoid:

- excessive neon
- constant animated backgrounds
- tiny sci-fi labels
- illegible HUD decoration
- motion that competes with task status

## Taso Orb

The orb is a reusable state component rather than decorative branding only.

Behavior:

- idle: slow breathing glow
- listening: reactive waveform/ripple
- understanding: compact orbit animation
- planning: segmented ring
- executing: progress orbit
- testing: stepped pulse
- deploying: expanding rings
- approval: amber paused state
- success: brief completion bloom
- error: stable red accent, no aggressive flashing

Reduced-motion mode must replace animations with static state indicators.

## Core UI components

- AppShell
- Sidebar / MobileNav
- ProjectSwitcher
- TasoOrb
- VoiceButton
- VoiceSession
- CommandComposer
- ConversationMessage
- MissionCard
- MissionTimeline
- TaskCard
- StatusBadge
- ApprovalCard
- DeploymentCard
- SystemHealthCard
- NotificationCard
- ProjectMemoryPanel
- ActivityTimeline
- PreviewLinkCard
- AgentDetailDrawer

## Responsive rules

Desktop:

- persistent sidebar
- multi-column command center
- optional right contextual drawer

Tablet:

- compact sidebar
- two-column cards

Mobile:

- bottom navigation for primary actions
- project switcher always reachable
- hold-to-talk reachable with one thumb
- approval CTA full width
- timeline collapses into stacked cards
- no horizontal data tables for core workflows

## Accessibility

- keyboard-accessible command composer
- visible focus states
- minimum touch target 44px
- screen-reader state labels for Taso Orb
- status never communicated by color alone
- reduced motion support
- transcript available for voice output

## Security UX

The interface must visibly distinguish:

- READ
- WRITE
- HIGH_IMPACT

HIGH_IMPACT requires explicit approval and shows affected project/environment.

Secrets are never displayed in plaintext after creation. Agent permissions and provider capabilities must be inspectable without exposing credentials.

## M1 frontend scope

M1 should ship these first:

1. App shell
2. Global Command Center
3. Projects list
4. Project Overview
5. Taso text workspace
6. Task list + task detail
7. Approvals Center
8. Notifications Center
9. responsive mobile layout
10. API integration with the existing Taso Core endpoints

Voice UI may be visually scaffolded in M1, but production voice transport and speech services belong to the next milestone unless the backend contract is ready.

## M1 acceptance criteria

- switching projects changes all workspace context
- Taso can submit a mission to the selected project
- mission state updates are visible without page reload
- approval-required missions cannot execute the protected action without approval
- preview URL is surfaced when available
- notification cards are understandable from a screenshot alone
- desktop and mobile flows are usable
- no secret appears in UI source, API responses or logs
- reduced-motion mode works
- critical controls remain usable on a 360px-wide screen

## Next milestone

After this UI contract is accepted, implementation should proceed as:

1. frontend foundation and design tokens
2. AppShell + project switcher
3. Command Center
4. Project Workspace + Taso text conversation
5. Tasks / approvals / notifications
6. event streaming / polling integration
7. M1 preview deployment
8. voice transport + Talk to Taso
