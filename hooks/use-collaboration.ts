"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { CollaboratorCursor } from "@/components/live-editor/collaborator-cursors";
import { getRandomColor } from "@/components/live-editor/collaborator-cursors";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";

interface UseCollaborationOptions {
  repoId: string | null;
  filePath: string | null;
  userName: string;
  enabled?: boolean;
}

interface CollaborationState {
  ydoc: Y.Doc | null;
  provider: WebsocketProvider | null;
  yText: Y.Text | null;
  cursors: CollaboratorCursor[];
  connected: boolean;
}

export function useCollaboration({
  repoId,
  filePath,
  userName,
  enabled = true,
}: UseCollaborationOptions): CollaborationState {
  const [cursors, setCursors] = useState<CollaboratorCursor[]>([]);
  const [connected, setConnected] = useState(false);

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);

  const cleanup = useCallback(() => {
    providerRef.current?.destroy();
    ydocRef.current?.destroy();
    providerRef.current = null;
    ydocRef.current = null;
    yTextRef.current = null;
    setCursors([]);
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!enabled || !repoId || !filePath) {
      cleanup();
      return;
    }

    const room = `${repoId}:${filePath}`;
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, room, ydoc);
    const yText = ydoc.getText("monaco");

    ydocRef.current = ydoc;
    providerRef.current = provider;
    yTextRef.current = yText;

    // Set local awareness state
    const clientId = ydoc.clientID;
    const color = getRandomColor(clientId);

    provider.awareness.setLocalStateField("user", {
      name: userName,
      color,
    });

    // Track connection status
    provider.on("status", ({ status }: { status: string }) => {
      setConnected(status === "connected");
    });

    // Track remote cursors
    const handleAwarenessChange = () => {
      const states = provider.awareness.getStates();
      const remoteCursors: CollaboratorCursor[] = [];

      states.forEach((state, cid) => {
        if (cid === clientId) return;
        if (state.user) {
          remoteCursors.push({
            clientId: cid,
            user: state.user,
            cursor: state.cursor ?? null,
          });
        }
      });

      setCursors(remoteCursors);
    };

    provider.awareness.on("change", handleAwarenessChange);

    return () => {
      provider.awareness.off("change", handleAwarenessChange);
      cleanup();
    };
  }, [repoId, filePath, userName, enabled, cleanup]);

  return {
    ydoc: ydocRef.current,
    provider: providerRef.current,
    yText: yTextRef.current,
    cursors,
    connected,
  };
}
