// src/lib/codexHandler.js
// Фасад для Senti Codex: публічне API, щоб інші файли нічого не ламали

export {
  CODEX_MEM_KEY,
  CODEX_MEM_KEY_CONST,
  setCodexMode,
  getCodexMode,
  clearCodexMem,
} from "./codexState.js";

export {
  CB,
  buildCodexKeyboard,
  handleCodexUi,
  handleCodexCommand,
} from "./codexUi.js";

export { handleCodexGeneration } from "./codexGeneration.js";
