# TripRelay

Free Vietnam enquiry-to-reviewed-quote work for small travel agencies. V1 ends at the final branded quote; payments, booking, ticketing and visas are outside V1.

[Development preview](https://rare-falcon-153.convex.site). Sign-in, agency profiles/logos, saved enquiries and confirmed English intake work. Supplier preparation, protected review, complete-comparison checks and branded PDF gates are implemented and checked with simulated data. The first real priced, reviewed Vietnam quote remains unfinished. No sample price is a live offer.

## Stack and setup

React/Vite frontend; Convex database/backend/auth/file storage/static hosting; GitHub source. Use Node.js 24 and your own authorized Convex project.

```sh
npm ci
npx convex dev --once
node scripts/setup-auth.mjs
npm run dev
```

Convex setup writes actual local deployment settings into the ignored environment file. The auth script configures signing keys through the private CLI without saving/printing key values. The local frontend runs at http://localhost:5173. Keep Convex development running while editing backend functions. Ordinary signup never grants reviewer permissions; an explicit confirmed-identity administrative grant is required.

## Checks and deployment

```sh
npm test
npm run build
npm run check:backend
npm run check:suppliers
```

The 10 October checkpoint passes 147 automated checks/build. Supplier access currently returns blocked because relay/fixed-IP/hotel settings are missing. Exit 2 means configuration or flight authentication is blocked. Even successful flight sign-in does not prove hotel access or live pricing; the command never creates a booking, ticket, search or quote.

`npm run deploy` uses Convex static hosting; Git push does not deploy. For a configured development deployment, `npx @convex-dev/static-hosting upload --build` builds/uploads its preview. Configure auth SITE_URL for your actual hosted site. Production and complete live quoting remain unverified.

## Private settings and review

TBO_MODE, TBO_END_USER_IP, TBO_PROXY_URL, TBO_USERNAME, TBO_PASSWORD, TBO_AIR_USERNAME, TBO_AIR_PASSWORD and TBO_AIR_CLIENT_ID belong in Convex environment settings. Use only the authorized existing supplier relay. Keep all values out of Git, chat and frontend fields. Supplier actions perform search/recheck/terms only; agencies never see supplier identities, references or underlying costs.

Operator markup is 10% on verified supplier cost, followed by saved agency markup. Final quotes require complete current NET/GST-inclusive cost, fees, terms, availability and required human review. The first 100 distinct approved versions count once each. AI drafts are unpriced and separately gated by enablement, verified pricing and configured budgets.

## Source map and current limits

- `src/`: agency, enquiry/intake, quote and private reviewer interfaces.
- `convex/`: owner-scoped data, internal suppliers, review/PDF and static hosting.
- `lib/`: comparison/pricing/readiness, supplier preparation and PDF/fonts/licenses.
- `tests/`: automated and optional synthetic browser/PDF exercises; samples are excluded from real-user evidence.
- `scripts/`: private auth setup, supplier-access check and anonymous daily summary.

Optional browser scripts need a separately installed Playwright module/browser through their environment variables; they are not part of npm test. Real supplier entitlement/mappings, complete ground/meal/NET/GST/fee/terms/freshness facts, exact reviewer identity, approved delivery and genuine pilot use remain necessary. WhatsApp linking/delivery is postponed. Raw English enquiries are human-confirmed, with no automatic verification of all preferences or prices.
