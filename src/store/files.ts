import { invoke } from "@tauri-apps/api/core";

export const homeDir = () => invoke<string>("home_dir");
export const readFile = (path: string) => invoke<string | null>("read_file", { path });
export const listDirs = (path: string) => invoke<string[]>("list_dirs", { path });
export const indexDirs = () => invoke<string[]>("index_dirs");
