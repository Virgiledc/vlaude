const DRIVE_RE = /^([A-Za-z]):[\\/](.*)$/;
const WSL_UNC_RE = /^\\\\wsl(?:\$|\.localhost)\\[^\\]+\\(.*)$/i;

export function winToWslPath(input: string): string {
  const p = input.trim();
  const wsl = p.match(WSL_UNC_RE);
  if (wsl) return "/" + wsl[1].replace(/\\/g, "/");
  const drive = p.match(DRIVE_RE);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
  return p.replace(/\\/g, "/");
}
