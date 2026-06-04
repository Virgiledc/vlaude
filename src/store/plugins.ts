import { invoke } from "@tauri-apps/api/core";

export interface PluginItem {
  invocation: string; // "/adversarial" or "/vercel:deploy"
  kind: "skill" | "command";
  source: string; // "global" or the plugin name
  description: string;
}

export async function listClaudePlugins(): Promise<PluginItem[]> {
  try {
    return await invoke<PluginItem[]>("list_claude_plugins");
  } catch (e) {
    console.error("list_claude_plugins failed", e);
    return [];
  }
}

export async function loadFavorites(): Promise<string[]> {
  try {
    const raw = await invoke<string | null>("load_plugin_favorites");
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch (e) {
    console.error("load_plugin_favorites failed", e);
    return [];
  }
}

export async function saveFavorites(favorites: string[]): Promise<void> {
  try {
    await invoke("save_plugin_favorites", { data: JSON.stringify(favorites) });
  } catch (e) {
    console.error("save_plugin_favorites failed", e);
  }
}
