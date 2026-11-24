# NDA layout and signer fields

For **new** Portal NDAs, OpenSign passes the party name, address and effective
date to this renderer *before* any file is uploaded or any invitation is
created. It accepts exactly the reviewed blank PDF for the selected MM, CyCrypt
or XPress agreement. It flows all 14 clauses, then measures full-width signer
blocks. Those measurements (PDF points, from the top left) are the source of
OpenSign's two separate signer field sets. Do not use the old layout.json
percentages. The template mapping and internal company name still come from
that configuration.

Both signers retain their own signature, name, optional job title, email and
actual signing-date fields. The agreement's “made as of” date is not an
execution date. No PDF is rewritten in place and no historical envelope is
enrolled. The bridge runs the renderer with private input/output pipes, a time
and output limit, no inherited credentials, and no fallback to the old geometry.
Production uses the pinned Linux PyMuPDF wheels in the server image and mounts
only nda_layout.py read-only. A changed template hash or unsupported text
must be investigated; never bypass pinning on a signed or unreviewed source.

Standalone offline operator mode is also available. Provide an owner-only
UTF-8 JSON file outside Git with effectiveDateText, companyName, companyAddress
and two signers (counterparty, internal; each with name, title and email).
Standalone output is an unsigned operator copy, not an OpenSign envelope.
Never commit input fields, PDFs, signature images or private templates.

    uv run --no-project --with pymupdf python nda_layout.py --template "$NDA_TEMPLATE_DIR/mm-mutual-nda-template.pdf" --input /private/input.json --output /private/new.pdf
    NDA_TEMPLATE_DIR=/path/to/reviewed/pdf uv run --offline --no-project --with pymupdf python -m unittest -v test_nda_layout.py

## Offline two-signer qualification

Run the OpenSignServer test spec/ndaEffectiveDate.postgres.node.test.js on an
isolated local opensign_nda_date_test database, with NDA_TEST_LAYOUT and
NDA_TEST_TEMPLATE_DIR pointing at the approved blank templates/config and
NDA_LAYOUT_PYTHON / NDA_LAYOUT_SCRIPT pointing at the pinned interpreter and
renderer. Set NDA_TEST_ARTIFACTS to an owner-only temporary directory. From
apps/OpenSign run node scripts/test-nda-signer-layout.mjs with the same
NDA_TEST_ARTIFACTS plus PLAYWRIGHT_MODULE and CHROMIUM_PATH for local Chromium.
This uses the real guest required-field validator and PDF embedding code,
first for the counterparty, then over that PDF for the internal signer.
The browser has no live network transport. All synthetic test artifacts stay
outside Git.

## Completion copies

The matching Portal Worker enrolls new requests using the private
/portal/v1/nda/record-copies route. Ordinary signer invitations remain enabled;
the old generic completion email is disabled for those requests to avoid
duplicates. The Worker separately emails each signer after verifying two
distinct Signed activity records, the matching request and signer identities,
and the SHA-256 of the final signed PDF. Each message contains just that PDF
as an attachment. No CC, BCC, automation owner or archive recipient is added.
A per-recipient delivery ledger and periodic reconciliation recover failed or
missed notifications without resending copies already recorded as accepted.
Provider acceptance is not proof of inbox delivery. Ambiguous provider
acceptance during a crash may require reconciliation. Prior executed records
are not backfilled.
