import { invoke } from "@tauri-apps/api/core";

export const wslHome = () => invoke<string>("wsl_home");
export const listWslDirs = (path: string) => invoke<string[]>("list_wsl_dirs", { path });
