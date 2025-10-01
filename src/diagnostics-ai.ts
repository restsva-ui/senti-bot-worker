// src/diagnostics-ai.ts
// Шар реекспорту для зворотної сумісності.
// Вся логіка діагностики знаходиться у src/diagnostics.ts.
// Завдяки цьому імпорт з "./diagnostics-ai" не впаде.

export { handleDiagnostics } from "./diagnostics";