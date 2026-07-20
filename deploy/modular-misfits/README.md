# Modular Misfits OpenSign deployment

This deployment runs the AGPL OpenSign fork with PostgreSQL/PostGIS. It does not
run MongoDB and does not expose the database port. The public gateway binds only
to loopback so Cloudflare Tunnel remains the internet-facing ingress.

The portal NDA bridge is separate from OpenSign's licensed production API. It is
limited to the three portal NDA templates, authenticated with a dedicated bearer
secret, and sends lifecycle callbacks with an HMAC-SHA256 signature.

Private legal templates are never copied into this public repository. They are
mounted read-only using `PORTAL_NDA_TEMPLATE_DIR`; the non-secret placement map is
mounted using `PORTAL_NDA_CONFIG_DIR`.

Start the isolated stack with:

```sh
docker compose --env-file .env -f compose.yml up --build -d
```

On the production Linux host, create the private cross-stack network and include
the portability override so Caddy can reach the temporary legacy Documenso
service without publishing it beyond loopback:

```sh
docker network create modular-misfits-esign-shared
docker compose --env-file .env -f compose.yml -f compose.cloud.yml up --build -d
```

The Linux host must keep ports `3000` and `3100` bound to loopback. Public HTTP
traffic enters only through Cloudflare Tunnel; PostgreSQL is never published.

For a workstation-hosted production deployment, run `watchdog.sh` from a user
LaunchAgent at login and once per minute. The watchdog starts Docker Desktop when
needed, reconciles the Compose stack, and waits for the private health endpoint.
