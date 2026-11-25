# Blank Word files in MisfitSign Templates

**Templates → Manage templates** (`/report/6TeaPr321t`) includes a separate
**Blank NDA Word templates** panel. These are editable originals, not signing
requests or copies of executed contracts. The panel does not change the native
template list or grant rights to anyone else's signing templates.

## Private installation

Retrieve the three **blank** approved originals from the company's NDAs shared
drive, and verify the effective-date/counterparty placeholders, 14 clauses,
and both empty signature blocks. Never use an executed record as a source.
The file SHA-256 checks in `cloud/company/blankNdaTemplates.js` must match
before the service will list or serve the downloads. Do not commit the files.

Install the following private directory **next to the mounted layout.json**
(on the production host: `/srv/opensign/portal-nda/templates/blank-word/`).
It is already covered by the signing server's read-only configuration mount.
Do not put the files in the client build, a public web directory, or Parse files.

| Private filename | Approved Word original |
|---|---|
| mm.docx | ModularMisfits_Mutual_NDA_Template.docx |
| cycrypt.docx | CyCrypt_Mutual_NDA_Template.docx |
| xpress.docx | XpressGroup_Mutual_NDA_Template.docx |
| owner-id | Single verified requester's immutable Parse user ID, plain text |

Use root ownership, the server's runtime group, mode 0750 for the directory
and 0440 for its files. Verify the owner's identity and their one active
organization membership before provisioning the ID. The other permitted
account is the designated `COMPANY_DOCUMENT_READER_ID`. Listing and each
download recheck the exact identity and current organization membership;
a disabled account, conflicting membership, or missing organization fails
closed. Replacing an original requires an explicit review and digest update.
Clearing the template owner file revokes that owner's Word downloads; revoking
the company reader is governed by the existing company-document settings.

## Qualification

From apps/OpenSign, run the BlankNdaWordTemplates Vitest suite. From
apps/OpenSignServer, set `WORD_TEST_DATABASE_URI` to a disposable loopback
PostgreSQL database named `opensign_word_test` and `WORD_TEST_ORIGINALS_DIR`
to a private directory containing the three verified files with the names
above; then run `node --test spec/blankNdaWordTemplates.postgres.node.test.js`.
It checks both authorized accounts, per-file original bytes, anonymous and
out-of-scope accounts, revocation, invalid keys, and substituted files.
No signing request or email is part of qualification.
