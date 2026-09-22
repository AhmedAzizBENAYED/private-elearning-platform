# JEENISo private e-learning platform — front-end implementation brief

Paste this file (or its "Prompt" section) into your local coding agent, from the folder where the React project will live. Copy `tokens.css`, `tokens.ts` and `assets/` next to it.

## Prompt

Build the front end of a private e-learning platform for an association (roles ADMIN / MEMBER) in **React + TypeScript**, following the validated UI/UX design. The backend already exists under `/api/v1` and every request carries `Authorization: Bearer <access_token>`.

The design is a 52-board canvas ("JEENISo Learning Platform — UI/UX", Claude Design artifact). Boards are also in `design-boards/` as `.dc.html` (inline-styled markup, useful to read exact sizes, spacing and copy; image URLs in them are not usable locally, use `assets/`).

Rules that must hold:

1. **Identity comes from the official charte** (JEENISo identity manual, March 2018). Do not invent a generic SaaS look, do not change official colours or the logo. Use `tokens.css` / `tokens.ts` as the only source of colours, type, spacing, radii. Montserrat 400–900 (self-host, `font-display: swap`), Arial as fallback.
2. **Actions use navy `#1A4A6B`, not brand blue `#3594D6`** (3.30:1 on white). Brand blue is for rules, progress, large numerals and non-text graphics.
3. **No invented features.** No payment, subscription, marketplace, social, forum, messaging, gamification, certificate. Anything the design lists as `BACKEND GAP — NOT IMPLEMENTED` is not built (no forgot-password link, no member edit/deactivate/reset, no profile page, no unenroll, no resume-at-position). Items marked `TO CONFIRM WITH API` are implemented behind a small adapter and confirmed against the real API; never assume an endpoint — read the existing backend/OpenAPI first.
4. **The front end never talks to Google Drive or any storage provider** and never shows its name or URLs. Video and document access URLs are whatever the API returns.
5. Only **VIDEO** lessons count for progress and course completion. TEXT / DOCUMENT / LINK show a type icon only. Course completed screen shows "100%", no certificate.
6. Lesson editor: VIDEO → video file + duration (mm:ss); DOCUMENT → document file; TEXT → text content, **never** a file field; LINK → URL, **never** a file field.
7. Course lifecycle DRAFT → PUBLISHED → ARCHIVED, one direction, publish and archive confirmed in a dialog; delete module/lesson confirmed in a destructive dialog.
8. Accessibility (WCAG 2.1 AA): visible focus ring (3 px `#3594D6`, 2 px offset), targets ≥ 44 px, status never by colour alone (icon + text + shape), lesson states ✓ completed / ● current / ○ not started, labelled form fields with errors linked by `aria-describedby`, modal focus trap + Esc, `prefers-reduced-motion`.
9. Responsive: desktop 1440, laptop 1280, tablet 768, mobile 390. Learning page on mobile stacks Video → Lesson info → Progress → Previous/Next → Course outline; learning outline is 400 px (340 px laptop) sticky on ≥ 1024 px.

Suggested structure: `src/design-system/` (tokens, primitives, components), `src/features/member/`, `src/features/admin/`, `src/api/` (one typed client, base `/api/v1`, Bearer token, 401 → `/login`).

Suggested routes (front end only): `/login`, `/dashboard`, `/courses`, `/courses/:courseId`, `/courses/:courseId/lessons/:lessonId`, `/admin`, `/admin/members`, `/admin/courses`, `/admin/courses/:courseId`, `/admin/courses/:courseId/lessons/:lessonId`. Guards: unauthenticated → `/login`; MEMBER on `/admin` → 403 page; learning page requires enrollment.

Components to build (boards DS 05–08): Button, TextField, Select, Textarea, SegmentedControl, FileDropzone, Badge, Progress, Avatar, Modal/ConfirmDialog, Toast, Menu, Tabs, Table, Header/Sidebar/BottomNav, Breadcrumb, CourseCard, LessonItem, ModuleHeader, VideoPlayer (native `<video>`, custom controls), CourseOutline, EmptyState/ErrorState/Skeleton.

Work order: 1) tokens + fonts + primitives, verified against DS 05–08; 2) auth + routing + API client; 3) member screens (Login → Dashboard → Catalogue → Course details → Learning → Completion) with all listed states; 4) admin screens (Dashboard → Members → Courses → Course editor → Lesson editor). For each screen, implement every state shown on its "States" board (loading, empty, error, success, disabled, unauthorized, not enrolled, enrolled, completed). Start by reading the "Backend gaps" and "Data needs & routing" boards, then compare with the real API and report mismatches before coding around them.

## Board index (canvas file → screen)

Cadrage: `Main` overview · `Charte-Analysis` · `Flows` · `Backend-Gaps` · `Data-Needs`
Design system: `DS-01-Brand` … `DS-08-Learning` · `Handoff-Tokens` · `Handoff-Components` · `Handoff-A11y`
Member: `Login`, `Login-States`, `Dashboard`, `Dashboard-States`, `Catalogue`, `Catalogue-States`, `Course-Details-New`, `Course-Details-Enrolled`, `Course-Details-States`, `Learning-Video`, `Learning-Video-States`, `Learning-Text`, `Learning-Document`, `Learning-Link`, `Course-Completed`, `Access-States`
Responsive: `Learning-Laptop`, `Learning-Tablet`, `*-Mobile` (login, dashboard, catalogue, details, learning, completion)
Admin: `Admin-Dashboard`, `Admin-Members(+States)`, `Admin-Courses(+States)`, `Admin-Course-Editor`, `Admin-Editor-States`, `Admin-Lesson-Editor`, `Admin-Lesson-Types`, `Admin-Tablet`, `Admin-Mobile-Courses`, `Admin-Mobile-Nav`

## Known assumptions

- UI copy is in English (per the brief); keep strings externalised, layouts tolerate ~30 % longer French text.
- Logos in `assets/` were extracted from the raster PDF: replace with the official vector files (request from the Marketing Manager) before production. Course thumbnails are duotone placeholders.
- Video completion is assumed to happen when the video ends; no manual "mark as complete" button unless the API requires an explicit call.
