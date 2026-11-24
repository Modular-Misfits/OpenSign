# Read-only company documents in MisfitSign

After signing in, the designated reader opens **Drive → Company documents** or
`/company-documents`. The personal drive, signer inbox and signing workflow do
not change. The library includes every non-folder company document in this
installation, including drafts, in-progress, expired, declined, completed and
soft-archived records. It shows the current PDF (the original for a draft) and
a completion certificate if one exists. It does not copy files into another
service, send requests, grant owner permissions or change document ACLs.

The operator sets exactly one active Parse user ID and one organization ID in
the deployment's private Compose environment:

- `COMPANY_DOCUMENT_READER_ID`: the verified employee's immutable `_User.objectId`.
- `COMPANY_DOCUMENT_ORG_ID`: the verified shared `contracts_Organizations.objectId`.

Verify the employee by joining their active extended user row to the account
and organization, not by selecting a contact from the signer address book.
Missing configuration disables the view. The authenticated Parse cloud function
checks the user ID and current, unambiguous active membership on every list
and file request. Document ownership is joined to current organization membership,
not a matching email domain, a single legacy tenant, or the entire database.
Folders, inconsistent or ambiguous owner pointers, and unrelated organizations
are not included. New company documents are picked up on the next page load.
Documents owned outside the organization are not shared just because a contact
appears as a signer. The separate Google Drive archive covers only completed
documents and is not modified by this feature.

This deployment uses PostgreSQL and local Parse file storage. The endpoint uses
a read-only transaction and returns a projection, not a Parse document. It does
not expose workflow object IDs, signer contacts, invitation links, signatures
or the audit trail. Opening a file rechecks access, validates and signs the
stored file path on this installation, and returns a two-minute file link.
Removing the grant does not recall an already downloaded file.

## Qualification

Use a **fresh, disposable** local PostgreSQL database named
`opensign_company_test` and supply its URI via `COMPANY_TEST_DATABASE_URI`.
The integration test creates fixture accounts and documents in that database;
it does not use production accounts or send messages.

    cd apps/OpenSignServer
    node --test spec/companyDocuments.postgres.node.test.js
    cd ../OpenSign
    NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/pages/CompanyDocuments.test.jsx

Before releasing, compare the qualifying document IDs to an independent
company-owner inventory and compare actual Signed audit events for the
requesting signer against the library. Verify PDF bytes, external-organization
denial, denial for an ungranted account, anonymous rejection and the client
route. Never print file links, credentials, session tokens or document contents.

## Deploy / rollback

On the customized production stack, do not rebuild from an unrelated dirty
checkout. Overlay the new server function on the verified running server image
and the client build on the verified running client image (keeping old hashed
assets for open signing tabs). Back up the source/config and database, keep the
old image tags, and recreate only the server and client during an authorized
cutover. Keep the base Compose environment and default image tags in sync for
normal reconciliation. To revoke just this grant, clear its two settings and
recreate the server. For release rollback restore the pre-release images and
scoped source/config. Do not restore the database; doing so can erase signatures
recorded after the backup.
