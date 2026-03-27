import { useEffect, useRef, useState, useCallback } from "react";

interface WsMessage {
  taskId: number;
  step: string;
  message: Record<string, unknown>;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const listenersRef = useRef<Set<(msg: WsMessage) => void>>(new Set());

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          setLastMessage(msg);
          for (const listener of listenersRef.current) {
            listener(msg);
          }
        } catch {
          // ignore non-JSON messages
        }
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const subscribe = useCallback((fn: (msg: WsMessage) => void) => {
    listenersRef.current.add(fn);
    return () => { listenersRef.current.delete(fn); };
  }, []);

  return { connected, lastMessage, subscribe };
}
