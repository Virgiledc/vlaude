import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  AUTOSTOP_MARGIN_MS,
  MAX_RECORD_MS,
  cleanTranscript,
  micView,
  resultConsumable,
  safetyTimeoutMs,
  useDictation,
  type DictationSnapshot,
} from "./dictation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = invoke as unknown as Mock;

const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

const snap = (over: Partial<DictationSnapshot> = {}): DictationSnapshot => ({
  phase: "idle",
  activeId: null,
  progress: 0,
  error: null,
  ...over,
});

const reset = () =>
  useDictation.setState({ activeId: null, phase: "idle", progress: 0, error: null, startedAt: 0, timer: null });

describe("cleanTranscript", () => {
  it("laisse une phrase simple intacte", () => {
    expect(cleanTranscript("Corrige le bug du resize")).toBe("Corrige le bug du resize");
  });
  it("supprime les blancs en bordure", () => {
    expect(cleanTranscript("  bonjour  ")).toBe("bonjour");
  });
  it("aplatit les retours à la ligne en espaces", () => {
    expect(cleanTranscript("ligne un\nligne deux\r\nligne trois")).toBe("ligne un ligne deux ligne trois");
  });
  it("compacte les espaces multiples", () => {
    expect(cleanTranscript("un    deux\t trois")).toBe("un deux trois");
  });
  it("renvoie une chaîne vide pour du blanc pur", () => {
    expect(cleanTranscript(" \n \r\n ")).toBe("");
  });
  it("préserve accents et termes techniques", () => {
    expect(cleanTranscript("implémente useDictationEvents côté télémétrie")).toBe("implémente useDictationEvents côté télémétrie");
  });
});

describe("safetyTimeoutMs", () => {
  it("applique un plancher de 15 s", () => {
    expect(safetyTimeoutMs(0)).toBe(15_000);
    expect(safetyTimeoutMs(7_000)).toBe(15_000);
  });
  it("double la durée enregistrée au-delà du plancher", () => {
    expect(safetyTimeoutMs(30_000)).toBe(60_000);
  });
});

describe("resultConsumable", () => {
  it("accepte toujours en phase transcribing", () => {
    expect(resultConsumable("transcribing", 0)).toBe(true);
  });
  it("rejette un résultat précoce en phase recording", () => {
    expect(resultConsumable("recording", MAX_RECORD_MS - AUTOSTOP_MARGIN_MS - 1)).toBe(false);
  });
  it("accepte l'auto-stop backend en fin de fenêtre recording", () => {
    expect(resultConsumable("recording", MAX_RECORD_MS - AUTOSTOP_MARGIN_MS)).toBe(true);
  });
  it("rejette hors enregistrement", () => {
    expect(resultConsumable("idle", 999_999)).toBe(false);
    expect(resultConsumable("arming", 999_999)).toBe(false);
    expect(resultConsumable("downloading", 999_999)).toBe(false);
  });
});

describe("micView", () => {
  it("tuile au repos", () => {
    expect(micView("t1", snap())).toEqual({ cls: "", title: "Dicter en français", disabled: false });
  });
  it("enregistrement actif sur la tuile qui dicte", () => {
    const v = micView("t1", snap({ phase: "recording", activeId: "t1" }));
    expect(v.cls).toBe(" rec");
    expect(v.disabled).toBe(false);
  });
  it("armement et transcription désactivent le bouton de la tuile active", () => {
    expect(micView("t1", snap({ phase: "arming", activeId: "t1" })).disabled).toBe(true);
    expect(micView("t1", snap({ phase: "transcribing", activeId: "t1" })).disabled).toBe(true);
  });
  it("le download affiche la progression sur toutes les tuiles", () => {
    const v = micView("t2", snap({ phase: "downloading", activeId: "t1", progress: 42 }));
    expect(v.cls).toBe(" busy");
    expect(v.disabled).toBe(true);
    expect(v.title).toContain("42%");
  });
  it("désactive les autres tuiles pendant une dictée", () => {
    const v = micView("t2", snap({ phase: "recording", activeId: "t1" }));
    expect(v.disabled).toBe(true);
    expect(v.title).toBe("Dictée en cours dans une autre tuile");
  });
  it("affiche la dernière erreur uniquement sur la tuile fautive", () => {
    const err = snap({ error: { id: "t1", message: "micro absent" } });
    expect(micView("t1", err).cls).toBe(" failed");
    expect(micView("t1", err).title).toContain("micro absent");
    expect(micView("t2", err)).toEqual({ cls: "", title: "Dicter en français", disabled: false });
  });
});

describe("dictation store", () => {
  beforeEach(() => {
    reset();
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const sttOk = () =>
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "plugin:stt|is_available" ? Promise.resolve({ available: true }) : Promise.resolve(undefined)
    );

  it("démarre via arming puis recording", async () => {
    sttOk();
    useDictation.getState().toggle("t1");
    expect(useDictation.getState().phase).toBe("arming");
    await flush();
    expect(useDictation.getState().phase).toBe("recording");
    expect(useDictation.getState().activeId).toBe("t1");
    expect(invokeMock.mock.calls.map((c) => c[0])).toContain("plugin:stt|start_listening");
  });

  it("ignore le clic d'une autre tuile pendant l'enregistrement", async () => {
    sttOk();
    useDictation.getState().toggle("t1");
    await flush();
    const calls = invokeMock.mock.calls.length;
    useDictation.getState().toggle("t2");
    expect(useDictation.getState().activeId).toBe("t1");
    expect(useDictation.getState().phase).toBe("recording");
    expect(invokeMock.mock.calls.length).toBe(calls);
  });

  it("stoppe vers transcribing puis consomme le résultat", async () => {
    sttOk();
    useDictation.getState().toggle("t1");
    await flush();
    useDictation.getState().toggle("t1");
    expect(useDictation.getState().phase).toBe("transcribing");
    expect(invokeMock.mock.calls.map((c) => c[0])).toContain("plugin:stt|stop_listening");
    expect(useDictation.getState().consumeResult()).toBe("t1");
    expect(useDictation.getState().phase).toBe("idle");
  });

  it("rejette un résultat tardif arrivant pendant un nouvel enregistrement", async () => {
    sttOk();
    useDictation.getState().toggle("t1");
    await flush();
    expect(useDictation.getState().consumeResult()).toBeNull();
    expect(useDictation.getState().phase).toBe("recording");
  });

  it("accepte le résultat d'un auto-stop backend en phase recording", () => {
    useDictation.setState({
      activeId: "t1",
      phase: "recording",
      startedAt: Date.now() - (MAX_RECORD_MS - AUTOSTOP_MARGIN_MS),
    });
    expect(useDictation.getState().consumeResult()).toBe("t1");
    expect(useDictation.getState().phase).toBe("idle");
  });

  it("bascule en erreur si la transcription ne répond jamais", async () => {
    vi.useFakeTimers();
    sttOk();
    useDictation.getState().toggle("t1");
    await vi.advanceTimersByTimeAsync(0);
    useDictation.getState().toggle("t1");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useDictation.getState().phase).toBe("idle");
    expect(useDictation.getState().error).toEqual({ id: "t1", message: "transcription sans réponse" });
  });

  it("télécharge le modèle au premier usage sans enregistrer automatiquement", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "plugin:stt|is_available" ? Promise.resolve({ available: false }) : Promise.resolve(undefined)
    );
    useDictation.getState().toggle("t1");
    await flush();
    await flush();
    expect(useDictation.getState().phase).toBe("idle");
    expect(invokeMock.mock.calls.map((c) => c[0])).toContain("plugin:stt|install_model");
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("plugin:stt|start_listening");
  });

  it("signale l'erreur sur la tuile quand le micro est indisponible", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "plugin:stt|is_available") return Promise.resolve({ available: true });
      if (cmd === "plugin:stt|start_listening") return Promise.reject("AudioDevice: no input device");
      return Promise.resolve(undefined);
    });
    useDictation.getState().toggle("t1");
    await flush();
    expect(useDictation.getState().phase).toBe("idle");
    expect(useDictation.getState().error?.id).toBe("t1");
    expect(useDictation.getState().error?.message).toContain("no input device");
  });

  it("coupe le micro si la tuile ferme pendant l'armement", async () => {
    let resolveStart!: () => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "plugin:stt|is_available") return Promise.resolve({ available: true });
      if (cmd === "plugin:stt|start_listening") return new Promise<void>((r) => { resolveStart = () => r(); });
      return Promise.resolve(undefined);
    });
    useDictation.getState().toggle("t1");
    await flush();
    expect(useDictation.getState().phase).toBe("arming");
    useDictation.getState().abortIfActive("t1");
    expect(useDictation.getState().phase).toBe("idle");
    resolveStart();
    await flush();
    expect(invokeMock.mock.calls.map((c) => c[0])).toContain("plugin:stt|stop_listening");
    expect(useDictation.getState().phase).toBe("idle");
  });

  it("abort pendant l'enregistrement stoppe et réinitialise sans erreur", async () => {
    sttOk();
    useDictation.getState().toggle("t1");
    await flush();
    useDictation.getState().abortIfActive("t1");
    expect(useDictation.getState().phase).toBe("idle");
    expect(useDictation.getState().error).toBeNull();
    expect(invokeMock.mock.calls.map((c) => c[0])).toContain("plugin:stt|stop_listening");
  });
});
