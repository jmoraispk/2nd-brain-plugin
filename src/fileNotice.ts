import { App, Notice, TFile } from "obsidian";

/** Show a success notice whose action opens the exact vault file. */
export function showFileNotice(
  app: App,
  message: string,
  target: TFile | string,
  duration = 5000
): Notice {
  const file =
    typeof target === "string"
      ? app.vault.getAbstractFileByPath(target)
      : target;
  if (!(file instanceof TFile)) return new Notice(message, duration);

  const fragment = document.createDocumentFragment();
  fragment.append(`${message} · `);
  const open = document.createElement("a");
  open.textContent = "Open file";
  open.href = "#";
  fragment.append(open);

  const notice = new Notice(fragment, duration);
  open.addEventListener("click", async (event) => {
    event.preventDefault();
    notice.hide();
    await app.workspace.getLeaf(false).openFile(file);
  });
  return notice;
}
