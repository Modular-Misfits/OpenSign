import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import Parse from "parse";
import BlankNdaWordTemplates from "./BlankNdaWordTemplates";
vi.mock("parse", () => ({ default: { Cloud: { run: vi.fn() } } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it("does not advertise Word originals to other accounts", async () => {
  Parse.Cloud.run.mockResolvedValue({ templates: [] }); render(<BlankNdaWordTemplates />);
  await waitFor(() => expect(Parse.Cloud.run).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button")).toBeNull();
});
it("offers each company and downloads a named Word file without creating a request", async () => {
  const templates = ["mm", "cycrypt", "xpress"].map(key => ({key,company:key,filename:key+".docx"}));
  Parse.Cloud.run.mockResolvedValueOnce({templates});
  const makeUrl = vi.fn(()=>"blob:result");
  vi.stubGlobal("URL", { createObjectURL: makeUrl, revokeObjectURL: vi.fn() });
  const clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(){ clicked.push(this.download); });
  render(<BlankNdaWordTemplates />);
  for (const item of templates) {
    Parse.Cloud.run.mockResolvedValueOnce({filename:item.filename,base64:btoa("PK fixture")});
    fireEvent.click(await screen.findByRole("button",{name:"Download "+item.company+" NDA (.docx)"}));
    await waitFor(()=>expect(clicked).toContain(item.filename));
    expect(makeUrl.mock.lastCall[0].type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(Parse.Cloud.run).toHaveBeenLastCalledWith("blankndawordtemplates",{action:"download",key:item.key});
  }
  expect(Parse.Cloud.run).toHaveBeenCalledTimes(4);
});
