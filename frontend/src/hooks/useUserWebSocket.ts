import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE_URL, getUserToken } from "../lib/api";

export interface DispatchNotice {
  incident_id: string;
  status: string;
  dispatch_unit?: string;
  dispatch_eta_minutes?: number;
  dispatched_at?: string;
}

export function useUserWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<DispatchNotice | null>(null);

  useEffect(() => {
    const token = getUserToken();
    if (!token) return;

    const ws = new WebSocket(`${WS_BASE_URL}/ws/user?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "POLICE_DISPATCHED" && msg.data) {
          setDispatchNotice(msg.data as DispatchNotice);
        }
      } catch {
        // ignore malformed message
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const sendLocationPing = useCallback(
    (payload: {
      lat: number;
      lng: number;
      incident_id?: string | null;
      battery?: number;
      speed?: number;
      route_deviation?: boolean;
      missed_checkin?: boolean;
    }) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "LOCATION_PING",
            ...payload,
          })
        );
      }
    },
    []
  );

  return { connected, dispatchNotice, sendLocationPing };
}
