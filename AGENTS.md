# TripRelay working instructions

## Product
Free V1 ends at the reviewed branded quote. No payments, booking, ticketing or visa operations. Operator markup is 10% on verified supplier cost, followed by saved agency markup. Supplier identities, references and underlying costs stay private. Review remains required for the first 100 distinct approved versions and continues until a later policy is decided. Test prices/users and coding helpers do not prove real outputs or product agents.

## Stack and data
React/Vite frontend; GitHub source; Convex database, backend, auth, storage and static hosting. Never add another host/database/auth service or a new supplier relay. Auth holds identities/sessions; agents hold branding; enquiry/intake revisions preserve briefs; supplier preparation/search/recheck records stay private; quote/comparison/review/release/PDF records gate delivery. Public agency data must be scoped to the signed-in owner. Reviewer access requires an explicit confirmed-identity grant. Do not expose terminal/file tools to agencies.

## Outside services
TBO internal actions use the authorized existing hotel/flight relay for quote-only search/recheck/terms. Credentials belong in Convex settings, never Git or the browser. Authentication alone does not prove pricing. AI drafts remain unpriced and require configured budgets, enablement and fresh verified pricing; raw customer/contact text must not reach the model. WhatsApp delivery is postponed.

## Working loop
Use plain words, state the next action before tools and ask one product question at a time. Read README, PRODUCT, DESIGN, PLAN and PROGRESS before changes. Use object-form Convex args/returns validators, indexed bounded reads, internal supplier actions and safe errors. Use Convex Workflow for multi-step flows, with automatic supplier retries off. Run npm test, npm run build and npx convex dev --once for backend changes; walk changed browser flows. Commit checked milestones. Deploy through npm run deploy; Git push does not deploy.

## Current truth
Development preview: https://rare-falcon-153.convex.site. 147 automated checks/build pass at the 10 October checkpoint. The foundation and synthetic quote/review/PDF checks work. Real supplier entitlement, complete reviewed Vietnam pricing, exact reviewer identity, production, genuine pilots and Main Flow remain unverified.
