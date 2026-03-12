"use client";

import { useRef, useCallback } from "react";
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import type { editor } from "monaco-editor";

// Map file extension → Monaco language
const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  php: "php",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  graphql: "graphql",
  dockerfile: "dockerfile",
  prisma: "prisma",
  env: "plaintext",
  txt: "plaintext",
  toml: "ini",
  ini: "ini",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  swift: "swift",
  kt: "kotlin",
  dart: "dart",
  lua: "lua",
  r: "r",
  svg: "xml",
};

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";

  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  if (name.endsWith(".d.ts")) return "typescript";

  return EXT_LANGUAGE_MAP[ext] ?? "plaintext";
}

interface MonacoEditorProps {
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
}

export default function MonacoCodeEditor({
  value,
  language,
  readOnly = false,
  onChange,
  onSave,
  onEditorMount,
}: MonacoEditorProps) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Ctrl+S / Cmd+S → save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave?.();
      });

      onEditorMount?.(editor, monaco);

      // Focus editor
      editor.focus();
    },
    [onSave, onEditorMount]
  );

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
      onChange={(v) => onChange?.(v ?? "")}
      onMount={handleMount}
      options={{
        readOnly,
        fontSize: 14,
        fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
        minimap: { enabled: true },
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true },
        padding: { top: 16 },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        renderWhitespace: "selection",
        tabSize: 2,
        lineNumbers: "on",
        folding: true,
        suggest: { preview: true },
      }}
      loading={
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Loading editor…
        </div>
      }
    />
  );
}
