import { describe, it, expect } from "vitest";
import { winToWslPath } from "./winToWsl";

describe("winToWslPath", () => {
  it("maps a C: drive path", () => {
    expect(winToWslPath("C:\\Users\\me\\img.png")).toBe("/mnt/c/Users/me/img.png");
  });

  it("lowercases the drive letter", () => {
    expect(winToWslPath("D:\\a\\b.png")).toBe("/mnt/d/a/b.png");
  });

  it("preserves spaces and accents", () => {
    expect(winToWslPath("C:\\Users\\V\\Capture d'écran 2026.png")).toBe(
      "/mnt/c/Users/V/Capture d'écran 2026.png"
    );
  });

  it("maps a \\\\wsl$ UNC path", () => {
    expect(winToWslPath("\\\\wsl$\\Ubuntu\\home\\v\\x.png")).toBe("/home/v/x.png");
  });

  it("maps a \\\\wsl.localhost UNC path", () => {
    expect(winToWslPath("\\\\wsl.localhost\\Ubuntu\\home\\v\\y.png")).toBe("/home/v/y.png");
  });

  it("passes a posix path through unchanged", () => {
    expect(winToWslPath("/mnt/c/x.png")).toBe("/mnt/c/x.png");
  });
});
