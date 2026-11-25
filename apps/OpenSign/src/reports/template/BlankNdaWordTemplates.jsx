import { useEffect, useState } from "react";
import Parse from "parse";

const call = (params) => Parse.Cloud.run("blankndawordtemplates", params);
const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function BlankNdaWordTemplates() {
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    call({ action: "list" }).then(({ templates }) => {
      if (active) setTemplates(templates);
    }).catch(() => { if (active) setError("Could not load blank Word templates. Refresh to retry."); });
    return () => { active = false; };
  }, []);

  async function download(template) {
    setError(""); setBusy(true);
    try {
      const { filename, base64 } = await call({ action: "download", key: template.key });
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      try { document.body.appendChild(a); a.click(); }
      finally { a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch { setError("Could not download the blank Word template. Please try again."); }
    finally { setBusy(false); }
  }

  if (!templates.length && !error) return null;
  return <section aria-label="Blank NDA Word templates" className="mx-3 my-4 rounded-box border border-base-300 p-3">
    <h2 className="font-semibold">Blank NDA Word templates</h2>
    <p className="text-sm">Download an editable Word copy. This does not create a signing request.</p>
    {error && <p role="alert">{error}</p>}
    <ul className="flex flex-wrap gap-2 mt-2">
      {templates.map(template => <li key={template.key}>
        <button type="button" className="op-btn op-btn-sm" disabled={busy}
          onClick={() => download(template)}>Download {template.company} NDA (.docx)</button>
      </li>)}
    </ul>
  </section>;
}
