import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getUserToken } from "../lib/api";

export interface UploadedAudioChunk {
  chunk_id: string;
  chunk_index: number;
  storage_key: string;
  sha256: string;
  size_bytes: number;
  timestamp: string;
}

async function computeSha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Records 10-second `.webm` audio chunks via MediaRecorder, hashes each chunk
 * with SHA-256, obtains a 5-minute presigned MinIO/S3 PUT URL from
 * `/api/recordings/upload-url`, uploads directly to object storage, and
 * confirms metadata in PostgreSQL via `/api/recordings/confirm`.
 */
export function useAudioEvidence() {
  const [isRecording, setIsRecording] = useState(false);
  const [chunks, setChunks] = useState<UploadedAudioChunk[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef<number>(0);
  const incidentIdRef = useRef<string | null>(null);

  const uploadBlob = useCallback(async (blob: Blob, incidentId: string) => {
    const idx = chunkIndexRef.current++;
    const sha256 = await computeSha256Hex(blob);
    const token = getUserToken();
    if (!token) return;

    const uploadMeta = await apiFetch<{
      upload_url: string;
      storage_key: string;
    }>("/api/recordings/upload-url", {
      method: "POST",
      body: JSON.stringify({
        incident_id: incidentId,
        chunk_index: idx,
        content_type: "audio/webm",
      }),
    });

    const putRes = await fetch(uploadMeta.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "audio/webm",
      },
      body: blob,
    });

    if (!putRes.ok) {
      throw new Error(`Object storage upload failed (${putRes.status})`);
    }

    const confirmed = await apiFetch<{
      recording: { chunk_id: string };
    }>("/api/recordings/confirm", {
      method: "POST",
      body: JSON.stringify({
        incident_id: incidentId,
        chunk_index: idx,
        storage_key: uploadMeta.storage_key,
        sha256_hash: sha256,
        duration_seconds: 10.0,
        size_bytes: blob.size,
      }),
    });

    setChunks((prev) => [
      ...prev,
      {
        chunk_id: confirmed.recording.chunk_id,
        chunk_index: idx,
        storage_key: uploadMeta.storage_key,
        sha256,
        size_bytes: blob.size,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  const startRecording = useCallback(
    async (incidentId: string) => {
      if (isRecording) return;
      incidentIdRef.current = incidentId;
      chunkIndexRef.current = 0;
      setError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined
        );
        recorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0 && incidentIdRef.current) {
            uploadBlob(event.data, incidentIdRef.current).catch((e) =>
              setError(String(e))
            );
          }
        };

        recorder.start(10_000);
        setIsRecording(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Microphone permission required for audio evidence"
        );
      }
    },
    [isRecording, uploadBlob]
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return { isRecording, chunks, error, startRecording, stopRecording };
}
