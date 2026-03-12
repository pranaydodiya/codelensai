import LiveEditorClient from "@/components/live-editor/live-editor-client";

export const metadata = {
  title: "Live Editor — CodeLens AI",
  description: "Browse and edit repository files in a VS Code-grade editor",
};

/**
 * Render the Live Editor page UI.
 *
 * @returns A JSX element that mounts the live editor client
 */
export default function EditorPage() {
  return <LiveEditorClient />;
}
