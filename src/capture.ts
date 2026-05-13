import { App, TFile } from "obsidian";
import { SecondBrainSettings } from "./settings";
import { resolveDailyLogPath, todayISO, todayHHMM } from "./paths";

export async function appendCapture(
  app: App,
  settings: SecondBrainSettings,
  content: string
): Promise<string> {
  const path = await resolveDailyLogPath(app, settings, todayISO());
  const timestamp = todayHHMM();
  const block = `\n[${timestamp}] ${content.trim()}\n`;

  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    const existing = await app.vault.read(file);
    await app.vault.modify(file, existing + block);
  } else {
    await ensureFolderExists(app, path);
    await app.vault.create(path, block.trimStart());
  }
  return path;
}

async function ensureFolderExists(app: App, filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  const folderPath = parts.join("/");
  if (!folderPath) return;
  if (app.vault.getAbstractFileByPath(folderPath)) return;
  await app.vault.createFolder(folderPath);
}
