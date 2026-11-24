import { useEffect, useState } from "react";
import { Link } from "react-router";
import Parse from "parse";

const call = (params) => Parse.Cloud.run("companydocuments", params);

export function CompanyDocumentsLink() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    call({ action: "access" }).then((result) => {
      if (active) setAllowed(result.allowed === true);
    }).catch(() => {}); // The personal drive still works if the feature is disabled.
    return () => { active = false; };
  }, []);
  return allowed ? (
    <Link to="/company-documents" className="op-btn op-btn-sm op-btn-outline">
      Company documents
    </Link>
  ) : null;
}

export default function CompanyDocuments() {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    call({ action: "list" }).then((result) => {
      if (active) { setRows(result.documents); setNext(result.next); }
    }).catch((err) => {
      if (active) setError(err.message || "Could not load company documents.");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  async function more() {
    setBusy(true); setError("");
    try {
      const result = await call({ action: "list", after: next });
      setRows((previous) => [...previous, ...result.documents]);
      setNext(result.next);
    } catch (err) { setError(err.message || "Could not load the next page."); }
    finally { setBusy(false); }
  }

  async function openFile(key, kind) {
    setBusy(true); setError("");
    try {
      const { url } = await call({ action: "open", key, kind });
      if (new URL(url).origin !== window.location.origin) throw new Error("Unexpected file location.");
      window.location.assign(url);
    } catch (err) { setError(err.message || "Could not open this file."); }
    finally { setBusy(false); }
  }

  return (
    <main className="p-4 md:p-6">
      <h1 className="font-bold text-xl">Company documents</h1>
      <p className="my-2">Read-only access across the company, including documents still awaiting signatures.</p>
      <Link to="/drive" className="underline">Back to my drive</Link>
      {error && <p className="my-3" role="alert">{error}</p>}
      {busy && <p role="status" className="my-3">Loading…</p>}
      {!busy && !error && !rows.length && <p className="my-3">No company documents found.</p>}
      {rows.length > 0 && <div className="overflow-x-auto my-4"><table className="op-table w-full">
        <thead><tr><th>Document</th><th>Owner</th><th>Status</th><th>Files</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}>
          <td>{row.title || "Untitled document"}</td><td>{row.owner}</td>
          <td>{row.status}{row.archived ? " · Archived" : ""}</td>
          <td>{row.hasPdf ? <button className="op-btn op-btn-sm" disabled={busy}
            onClick={() => openFile(row.key, "pdf")}>Open PDF</button> : "No PDF available"}
          {row.hasCertificate && <button className="op-btn op-btn-sm ml-2" disabled={busy}
            onClick={() => openFile(row.key, "certificate")}>Certificate</button>}</td>
        </tr>)}</tbody>
      </table></div>}
      {next && <button className="op-btn op-btn-sm" disabled={busy} onClick={more}>Load more documents</button>}
    </main>
  );
}
