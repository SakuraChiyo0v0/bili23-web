# Bili23 Web Functional Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static UI prototype with a deployable, responsive React/Vite client that exposes the existing Bili23 Web backend capabilities.

**Architecture:** `apps/web/src/client` is a small SPA served by Vite in development and copied to `apps/web/dist/client` in production. It talks to the existing Hono REST/SSE API. No backend behavior changes are expected except static hosting/build wiring.

**Tech Stack:** TypeScript strict / React / Vite / existing Hono API / Vitest.

## Global Constraints

- Keep the existing backend API contract unchanged.
- Keep mobile-first responsive behavior and existing Bili-style design tokens.
- Use only inline SVG icons and local assets; no external font or image CDN.
- Every user-visible feature must call a real endpoint, not mock data.
- Login page is out of scope; SESSDATA status may be shown if the API is available.
- P0 ends with a working client that can parse, select, download, monitor tasks, inspect history/files, and save settings.
- P1 ends with full supported type-entry UI, download options, extras, naming, parse history, and richer mobile interaction.
- Commit and push after P0 and again after P1.

## Task 0.1: Client scaffold and build wiring

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/tsconfig.client.json`
- Create: `apps/web/src/client/main.tsx`
- Create: `apps/web/src/client/App.tsx`
- Create: `apps/web/src/client/api.ts`
- Create: `apps/web/src/client/types.ts`
- Create: `apps/web/src/client/styles.css`
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/server/index.ts` only if static hosting path needs correction
- Test: `apps/web/tests/health.test.ts` must continue passing; add a client build smoke check through `pnpm --filter @bili23-web/web build`.

**Interfaces:**
- `api.ts` exports typed functions for parse, media options, task actions, history, files, config, parse history, and auth status.
- `App.tsx` owns route state (`parse`, `tasks`, `settings`) and renders responsive navigation.

- [ ] **Step 1:** Add React/Vite client dependencies and scripts.
- [ ] **Step 2:** Add client TypeScript config and Vite production build to `dist/client`.
- [ ] **Step 3:** Implement the API client and minimal shell with real health/config calls.
- [ ] **Step 4:** Run `pnpm -r typecheck`, `pnpm -r test`, and `pnpm --filter @bili23-web/web build`.

## Task 0.2: Parse workspace

**Files:**
- Create: `apps/web/src/client/components/icons.tsx`
- Create: `apps/web/src/client/views/ParseView.tsx`
- Modify: `apps/web/src/client/App.tsx`
- Test: client build and manual parse smoke through `/api/parse`.

**Interfaces:**
- `ParseView` accepts `config` and `onTasksChanged`.
- Type entry buttons send `{type, query, keyword, weekNum, pn, pages}` to `POST /api/parse`.
- URL mode sends `{urls}`.
- Results render selectable cards with cover, title, owner, duration, badge, type, and selected count.

- [ ] **Step 1:** Build type-entry chips and smart URL input.
- [ ] **Step 2:** Build result cards, select-all, selection count, and parse-history shortcuts.
- [ ] **Step 3:** Run typecheck/build and a manual parse smoke.

## Task 0.3: Download options and task creation

**Files:**
- Create: `apps/web/src/client/components/DownloadOptions.tsx`
- Modify: `apps/web/src/client/views/ParseView.tsx`
- Test: API client tests for download payload construction if practical; otherwise build plus manual duplicate/error smoke.

**Interfaces:**
- `DownloadOptions` consumes `MediaOptionSummary | undefined` and emits `DownloadOptionsPayload`.
- Payload includes quality, codec, audio quality, container, extras, naming rule, convention type, and number.
- Duplicate response renders a confirmable “force download” action.

- [ ] **Step 1:** Build media quality/audio/codec/container controls.
- [ ] **Step 2:** Build extras toggles and naming controls from config defaults.
- [ ] **Step 3:** Wire download creation and duplicate handling.
- [ ] **Step 4:** Run typecheck/build and manual download creation smoke.

## Task 0.4: Task queue, history, and files

**Files:**
- Create: `apps/web/src/client/views/TasksView.tsx`
- Modify: `apps/web/src/client/App.tsx`
- Test: build plus manual task-list/action smoke.

**Interfaces:**
- `TasksView` loads `GET /api/tasks`, polls or subscribes via SSE, and calls pause/resume/retry/cancel/delete/log endpoints.
- It renders history (`GET /api/history`) and files (`GET /api/files`) with raw file links.

- [ ] **Step 1:** Build task status cards, progress, speed, ETA, and controls.
- [ ] **Step 2:** Build history and file list tabs.
- [ ] **Step 3:** Verify pause/resume/retry/delete/log endpoints from the UI.
- [ ] **Step 4:** Run typecheck/build and manual smoke.

## Task 0.5: Settings workspace

**Files:**
- Create: `apps/web/src/client/views/SettingsView.tsx`
- Modify: `apps/web/src/client/App.tsx`
- Test: build plus manual config save smoke.

**Interfaces:**
- `SettingsView` loads `GET /api/config`, renders download/behavior/additional/naming/advanced groups, and saves with `PUT /api/config`.
- Changes are validated locally where possible and server errors are surfaced in the UI.

- [ ] **Step 1:** Build download settings and behavior settings.
- [ ] **Step 2:** Build additional content, naming, and advanced settings.
- [ ] **Step 3:** Save config and confirm response is reflected in the form.
- [ ] **Step 4:** Run typecheck/build and manual smoke.

## Task 1.1: Responsive and mobile interaction polish

**Files:**
- Modify: `apps/web/src/client/styles.css`
- Modify: `apps/web/src/client/App.tsx`
- Modify: `apps/web/src/client/views/*.tsx`
- Test: browser screenshots at desktop/tablet/mobile widths plus build.

**Interfaces:**
- Desktop uses top navigation and wide content panels.
- Mobile uses compact top bar plus bottom tab bar, 44px touch targets, full-width forms, and horizontally scrollable chips.
- Toasts and modal/drawer surfaces remain usable at 360px width.

- [ ] **Step 1:** Remove horizontal overflow at 360px, 768px, and 1440px widths.
- [ ] **Step 2:** Add visible loading, empty, error, and success states.
- [ ] **Step 3:** Verify all primary actions remain reachable without hover.
- [ ] **Step 4:** Run typecheck/test/build and capture responsive screenshots.

## Task 1.2: Final verification and P1 release

**Files:**
- Modify: `README.md` and `apps/web/README.md` if needed.
- Test: `pnpm check`; real browser smoke at `http://localhost:8787`.

- [ ] **Step 1:** Run full repository checks.
- [ ] **Step 2:** Start server, verify health and SPA response.
- [ ] **Step 3:** Verify parse, task list, history, files, and config endpoints from the browser.
- [ ] **Step 4:** Commit P1 and push to `origin/main`.

## Self-Review

- Coverage: P0 covers functional parse/download/task/history/file/settings flow; P1 covers responsive polish and verification.
- Placeholders: no “TBD” or “implement later” steps.
- Type consistency: `api.ts` response types mirror server DTO names and are reused by views.
- Scope: no engine parser/downloader changes are planned.