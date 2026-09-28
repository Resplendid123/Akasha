import api from "@/lib/api-client.ts";
import {
  AiGenerateDto,
  AiContentResponse,
  AiStreamChunk,
  AiStreamError,
} from "@/ee/ai/types/ai.types.ts";

export async function generateAiContent(
  data: AiGenerateDto,
): Promise<AiContentResponse> {
  const req = await api.post<AiContentResponse>("/ai/generate", data);
  return req.data;
}

export async function generateAiContentStream(
  data: AiGenerateDto,
  onChunk: (chunk: AiStreamChunk) => void,
  onError?: (error: AiStreamError) => void,
  onComplete?: () => void,
  onController?: (controller: AbortController) => void,
): Promise<AbortController> {
  const abortController = new AbortController();
  onController?.(abortController);
  try {
    const response = await fetch("/api/ai/generate/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      signal: abortController.signal,
      credentials: "include", // This ensures cookies are sent, matching axios withCredentials
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const processStream = async () => {
      let buffer = "";
      let completed = false;
      let failed = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");

          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                completed = true;
                onComplete?.();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  failed = true;
                  onError?.(parsed);
                  return;
                } else {
                  onChunk(parsed);
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }

        if (!completed && !failed && !abortController.signal.aborted) {
          onError?.({ error: "AI stream ended unexpectedly." });
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          onError?.({ error: error.message });
        }
      } finally {
        reader.releaseLock();
      }
    };

    processStream();
  } catch (error) {
    onError?.({ error: error.message });
  }

  return abortController;
}
