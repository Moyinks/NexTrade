# NexTrade Architecture Rules

> **Design the seam for the future without paying the complexity cost today.**

> **Build the smallest architecture that makes the next correct change easy.**

> **Different surfaces may have different personalities. They must not have different laws.**

These rules are product constraints, not aspirations.

1. **One concept gets one authority.** Transaction meaning, theme choice, attention arbitration, ledger state, and review state each have one owner.
2. **A local change is guilty until proven local.** Before changing a screen, trace every shared component, token, state, RPC, cache, workflow, and receipt that represents the same concept.
3. **State chooses semantics; CSS chooses appearance.** JavaScript may say `pending`; it must not decide the pending colour.
4. **Separate creation, state, presentation, and administration.** Deposit creates. Transaction Detail explains. Wallet summarizes. Review Queue decides.
5. **New UI consumes primitives before inventing styling.** A new radius, control size, colour, or motion rule must first justify why the design system lacks the required primitive.
6. **Every abstraction earns its existence.** Add a seam when it removes current duplication or protects a foreseeable extension, not because a hypothetical system might exist someday.
7. **Optional attention is budgeted.** Install, theme discovery, education, updates, and other discretionary prompts do not compete simultaneously.
8. **Architectural rules should be executable where practical.** Prefer audit checks, schema constraints, role checks, state machines, and debt ratchets over relying on memory.
9. **Financial truth never originates from presentation.** The UI reflects server/ledger authority. It does not infer balances or invent settlement state.
10. **The happy path is not enough.** Consider first use, return use, pending, failure, duplicate submission, offline/reconnect, refresh, back navigation, and future extension.
11. **Theme is semantic, not page-specific.** Screens consume semantic tokens. Dark and Light provide different values without forking page implementations.
12. **A financial event remains inspectable after the workflow ends.** Every transaction can open a durable Transaction Detail record. Workflow pages never become the permanent record.
13. **Persistent screen space must be earned by persistent relevance.** Selected values stay visible; alternatives and explanations use progressive disclosure.
14. **Never interrupt user-owned motion with application-owned rendering.** Live data may arrive while someone scrolls, but refreshes must preserve the active surface and scroll anchor.
15. **Back means origin, not destination.** Back navigation restores the route and meaningful local UI state the user came from.
16. **A route owns its position in space.** Primary destinations keep independent scroll state; Back restores exact origin state.
17. **Semantic colour belongs to information, not decoration.** State/value colour may be strong; containers stay predominantly neutral.
18. **Transparency is physical, not hierarchical.** Scrims, shadows and temporary motion may use alpha; financial surfaces and text hierarchy use deterministic semantic tokens.
19. **Immersion comes from continuity and hierarchy, not more layers.** Prefer continuous workspaces and selective containment over a dashboard made entirely of cards.
20. **Viewport chrome is environment, not layout.** Browser bars, Android gesture areas, iPhone safe areas, and standalone PWA chrome must not determine whether product controls remain reachable.
21. **Depth must explain hierarchy.** Equal-importance surfaces do not compete through unrelated shadows, tints, or elevation.
22. **Internal promotion is contextual, non-blocking, and truthful.** Product discovery may rotate quietly, but it pauses for user attention and never presents modeled strategy outcomes as guaranteed.
23. **Non-critical motion yields to the user and the device.** Decorative rotation pauses when hidden, on interaction, and under reduced-motion preferences.
24. **Brand is the landmark; route is context.** Persistent workspace chrome keeps NexTrade identity fixed while the active route is subordinate context. Task-immersive workflows may replace the workspace header only when the workflow itself is the user’s primary mental model.
25. **Route state exists before route paint.** Theme and route-dependent presentation must be correct on the first authenticated frame, not only after the user navigates.
26. **Analytical surfaces are persistent until explicitly dismissed.** Charts and inspection workspaces never close because of an ordinary scroll or ambiguous drag.
27. **Empty state collapses decisions instead of duplicating them.** When multiple empty modules ask for the same next step, one contextual decision surface owns that guidance.
28. **Live data never steals an active inspection viewport.** Real-time updates may continue while the user pans or zooms, but automatic following resumes only by explicit user action.
29. **Floating navigation owns physical space.** Content that should be read or tapped must be laid out above the navigation footprint and device safe area, never merely layered behind it.
30. **Smart Context has stable standard geography and exceptional promotion.** Advisory and attention states live after Activity and Market Pulse; only action-required states may move directly beneath the account anchor.
31. **A live visualization updates data without reconstructing presentation.** High-frequency ticks mutate existing chart objects and guides instead of destroying and recreating them.
32. **Async chart replacement is atomic.** The last valid chart remains visible until a requested range has valid replacement data; failed or stale requests never blank or overwrite it.
33. **A live stream proves identity before mutating a chart.** Coin, range, chart generation, socket, and series identity must all match before real-time data is accepted.
34. **Dark anchor surfaces own inverse content tokens.** A deliberately dark financial anchor remains legible in every page theme because its content colors are scoped to the anchor, not inherited from the page.
35. **Product-critical selection controls have product-owned presentation.** High-frequency filters and selectors use NexTrade interaction geometry and accessible semantics rather than uncontrolled browser-native chrome.
