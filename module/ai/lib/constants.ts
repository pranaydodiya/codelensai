// Shared AI constants (no Node-only deps — safe for client components)
export const SUPPORTED_LANGUAGES = [
  { value: "javascript", label: "JavaScript", ext: "js" },
  { value: "typescript", label: "TypeScript", ext: "ts" },
  { value: "python", label: "Python", ext: "py" },
  { value: "java", label: "Java", ext: "java" },
  { value: "go", label: "Go", ext: "go" },
  { value: "cpp", label: "C++", ext: "cpp" },
  { value: "c", label: "C", ext: "c" },
  { value: "csharp", label: "C#", ext: "cs" },
  { value: "rust", label: "Rust", ext: "rs" },
  { value: "php", label: "PHP", ext: "php" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["value"];
