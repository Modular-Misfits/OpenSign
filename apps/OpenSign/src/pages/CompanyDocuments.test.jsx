import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Parse from "parse";
import CompanyDocuments, { CompanyDocumentsLink } from "./CompanyDocuments";
vi.mock("parse", () => ({ default: { Cloud: { run: vi.fn() } } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const show = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

it("advertises the library only after affirmative server authorization", async () => {
  Parse.Cloud.run.mockResolvedValueOnce({allowed:false}).mockResolvedValueOnce({allowed:true});
  show(<CompanyDocumentsLink />); await waitFor(() => expect(Parse.Cloud.run).toHaveBeenCalledOnce());
  expect(screen.queryByRole("link")).toBeNull();
  cleanup(); show(<CompanyDocumentsLink />);
  expect((await screen.findByRole("link")).getAttribute("href")).toBe("/company-documents");
});

it("lists archived and pending documents without signer or management actions; requests files by key", async () => {
  Parse.Cloud.run.mockResolvedValueOnce({documents:[{key:"doc-key", title:"Signed by owner",
    owner:"Owner", status:"Completed", archived:true, hasPdf:true, hasCertificate:true}],next:"cursor"})
    .mockResolvedValueOnce({documents:[{key:"two",title:"Still awaiting",status:"In progress"}],next:null})
    .mockRejectedValueOnce(new Error("Access revoked"));
  show(<CompanyDocuments />);
  await screen.findByText("Signed by owner"); expect(screen.getByText("Completed · Archived")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/sign|delete|edit|resend/i})).toBeNull();
  fireEvent.click(screen.getByText("Load more documents")); await screen.findByText("Still awaiting");
  expect(Parse.Cloud.run).toHaveBeenCalledWith("companydocuments",{action:"list",after:"cursor"});
  fireEvent.click(screen.getByText("Certificate")); await screen.findByRole("alert");
  expect(Parse.Cloud.run).toHaveBeenCalledWith("companydocuments",{action:"open",key:"doc-key",kind:"certificate"});
});

it("shows a denied deep link without files or actions", async () => {
  Parse.Cloud.run.mockRejectedValueOnce(new Error("Access denied"));
  show(<CompanyDocuments />); expect((await screen.findByRole("alert")).textContent).toBe("Access denied");
  expect(screen.queryByRole("button")).toBeNull();
});
