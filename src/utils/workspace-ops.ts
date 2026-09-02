/**
 * Workspace operations: open a file in the editor and enumerate or run app
 * commands. The command palette contains mutators, so the API layer's
 * security gate must sit in front of executeCommand.
 */
import { App, Command, TFile } from 'obsidian';

/** Minimal Obsidian App interface exposing commands */
export interface AppInternal extends App {
  commands?: {
    commands?: Record<string, ObsidianCommand>;
    executeCommandById?(id: string): boolean;
  };
}

/** Minimal Obsidian command structure */
export interface ObsidianCommand {
  id: string;
  name: string;
  icon?: string;
}

export async function openFile(app: App, path: string) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file || !(file instanceof TFile)) {
    throw new Error(`File not found: ${path}`);
  }

  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  return { success: true };
}

export function getCommands(app: App): Command[] {
  const appInternal = app as unknown as AppInternal;
  const commands = appInternal.commands?.commands;
  if (!commands) {
    return [];
  }

  return Object.values(commands).map((cmd: ObsidianCommand) => ({
    id: cmd.id
    , name: cmd.name
    , icon: cmd.icon
  }));
}

/**
 * Run an Obsidian command by id. See the API layer's override for why it
 * sits behind the security gate: the command palette contains mutators
 * ("Delete current file", "Move file to…"), making an unguarded
 * executeCommand a write path around the security layer.
 */
export async function executeCommand(app: App, commandId: string) {
  await Promise.resolve();
  const appInternal = app as unknown as AppInternal;
  const success = appInternal.commands?.executeCommandById?.(commandId);
  return {
    success: !!success
    , commandId
  };
}
