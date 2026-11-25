# Modular Misfits OpenSign deployment

This deployment runs the AGPL OpenSign fork with PostgreSQL/PostGIS. It does not
run MongoDB and does not expose the database port. The public gateway binds only
to loopback so Cloudflare Tunnel remains the internet-facing ingress.

The portal NDA bridge is separate from OpenSign's licensed production API. It is
limited to the three portal NDA templates, authenticated with a dedicated bearer
secret, and sends lifecycle callbacks with an HMAC-SHA256 signature.

The same server also hosts the independent Telnyx failover endpoint at
`/api/portal/nda/webhooks/telnyx/failover`. It verifies Telnyx's Ed25519
signature, durably stores inbound NDA SMS events in PostgreSQL, and replays them
to the Cloudflare portal with a separate HMAC secret until delivery succeeds.

Private legal templates are never copied into this public repository. They are
mounted read-only using `PORTAL_NDA_TEMPLATE_DIR`; the non-secret placement map is
mounted using `PORTAL_NDA_CONFIG_DIR`.

## Portal NDA assets

The production `.env` uses stable host paths rather than paths from a developer
workstation:

```dotenv
PORTAL_NDA_TEMPLATE_DIR=/srv/opensign/portal-nda/templates/pdf
PORTAL_NDA_CONFIG_DIR=/srv/opensign/portal-nda/templates
```

Populate those paths from the private portal checkout before starting or
reconciling the stack:

```sh
sudo install -d -m 0755 \
  /srv/opensign/portal-nda/templates/pdf
sudo install -m 0644 \
  /path/to/portal/services/opensign/templates/layout.json \
  /srv/opensign/portal-nda/templates/layout.json
sudo install -m 0644 \
  /path/to/portal/services/opensign/templates/pdf/*.pdf \
  /srv/opensign/portal-nda/templates/pdf/
```

Run the asset preflight before every deployment. It rejects missing placement
configuration, missing company PDFs, and files that are not PDFs. Compose also
uses `create_host_path: false`, so an incorrect bind source is rejected instead
of being silently replaced with an empty directory.

```sh
./preflight.sh .env
```

Start the isolated stack with:

```sh
./preflight.sh .env
docker compose --env-file .env -f compose.yml up --build -d
```

On the production Linux host, import prebuilt amd64 images from a trusted build
machine, then start the same OpenSign-only deployment without building on the
2 GB runtime host:

```sh
./preflight.sh .env
docker compose --env-file .env -f compose.yml up --no-build -d
```

The Linux host must keep port `3100` bound to loopback. Public HTTP traffic
enters only through Cloudflare Tunnel; PostgreSQL is never published.

For employee read-only access across document owners, see [Company documents](COMPANY-DOCUMENTS.md).
For authenticated blank Word downloads in Templates, see [Blank NDA Word files](BLANK-NDA-WORD.md).

For a workstation-hosted production deployment, run `watchdog.sh` from a user
LaunchAgent at login and once per minute. The watchdog starts Docker Desktop when
needed, reconciles the Compose stack, and waits for the private health endpoint.

### Earlier effective dates for new NDAs

In The Compound's **Send NDAs** form, Tony can optionally choose today's date
(America/Chicago) or an earlier calendar date. This fills the existing “made
as of” blank in a new MM, CyCrypt, or XPress mutual NDA. Both parties see the
date before signing. Omitting it retains the previous workflow. This feature
does not change the signing, sending, expiration, completion, or certificate
timestamps and cannot be applied to an existing document.

The Portal verifies the requester's Access identity (not the internal signer
email), persists the override in its request ledger, and uses a versioned private
bridge route (the current Worker uses `POST /portal/v1/nda/record-copies`). A bridge without that
route cannot silently send a document with today's date. The bridge stamps
only a new unsigned copy, stores `PortalEffectiveDate`, and rejects conflicting
idempotent replays before any notification. No master keys or templates belong
in the Portal client or a shared repository.

**Release order:** qualify/deploy the bridge and additive Parse migration;
apply Portal D1 migration `0006_nda_effective_date.sql` before deploying the
matching Portal Worker/UI. Apply the additive record-copy migration 0007 as well.
The unsigned template is now reflowed before signature fields are placed; see
[layout and completion copies](nda-layout/README.md). Do not deploy an unrelated Portal branch wholesale.
For rollback stop offering overrides first and preserve dated queue rows and
both optional date columns; keep the compatible bridge available until pending
dated requests are reconciled. Do not backfill or rewrite completed agreements.

**Local qualification:** use a disposable loopback PostgreSQL database named
`opensign_nda_date_test`. From `apps/OpenSignServer`, set
`NDA_TEST_DATABASE_URI` and run `node --test spec/ndaEffectiveDate.postgres.node.test.js`.
For qualification with the real private templates, also set
`NDA_TEST_TEMPLATE_DIR` and `NDA_TEST_LAYOUT` to their local paths. The test
uses an isolated file store and loopback email sink. In the Portal checkout,
run `bun test src/lib/nda-effective-date.integration.test.js`,
`pnpm run typecheck:nda`, and `node scripts/nda-effective-date-ui.mjs` (provide
`CHROMIUM_PATH` if required). No production send is needed to qualify.
