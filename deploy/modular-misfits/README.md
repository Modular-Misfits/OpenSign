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

For a workstation-hosted production deployment, run `watchdog.sh` from a user
LaunchAgent at login and once per minute. The watchdog starts Docker Desktop when
needed, reconciles the Compose stack, and waits for the private health endpoint.
