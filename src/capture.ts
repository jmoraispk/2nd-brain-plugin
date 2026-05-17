import { App, TFile } from "obsidian";
import { SecondBrainSettings } from "./settings";
import {
  applyDatePlaceholders,
  findExistingDailyFile,
  todayISO,
  todayHHMM,
} from "./paths";

/**
 * Append a timestamped capture into today's daily log.
 *
 * Capture is template-path-driven (NOT find-by-name) so the file always lands
 * in the structured `Logs/{ISO_YEAR}/Q{Q}/W{WW}/<date>.md` layout. Find-by-name
 * is still used as a backstop: if today's daily file already exists somewhere
 * other than the template path (e.g. legacy flat `Logs/<date>.md` from older
 * versions, or a Logs/Week_NN/<date>.md that the migration script missed),
 * the existing file is RENAMED to the template path before the capture
 * appends. This means old captures stay continuous as the user uses the
 * plugin — no orphaned flat files growing alongside new structured ones.
 */
export async function appendCapture(
  app: App,
  settings: SecondBrainSettings,
  content: string,
  targetDate?: string
): Promise<string> {
  const date = targetDate ?? todayISO();
  const templatePath = applyDatePlaceholders(
    settings.dailyLogPathTemplate,
    date
  );

  let target = app.vault.getAbstractFileByPath(templatePath);

  if (!(target instanceof TFile)) {
    // The template path is empty. Check whether an existing file lives at a
    // different location (legacy flat path, etc.) and migrate it if so.
    const existingPath = findExistingDailyFile(app, settings, date);
    if (existingPath && existingPath !== templatePath) {
      const existing = app.vault.getAbstractFileByPath(existingPath);
      if (existing instanceof TFile) {
        await ensureFolderExists(app, templatePath);
        await app.fileManager.renameFile(existing, templatePath);
        target = app.vault.getAbstractFileByPath(templatePath);
      }
    }
  }

  const block = `\n[${todayHHMM()}] ${content.trim()}\n`;

  if (target instanceof TFile) {
    const existing = await app.vault.read(target);
    await app.vault.modify(target, existing + block);
  } else {
    await ensureFolderExists(app, templatePath);
    await app.vault.create(templatePath, block.trimStart());
  }
  return templatePath;
}

async function ensureFolderExists(app: App, filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  const folderPath = parts.join("/");
  if (!folderPath) return;
  if (app.vault.getAbstractFileByPath(folderPath)) return;
  await app.vault.createFolder(folderPath);
}
