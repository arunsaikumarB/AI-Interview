/**
 * POST multipart form and observe upload completion vs server response.
 * Used so the orb can move composing → connecting when the body has been sent
 * and the server is still processing (no artificial timers).
 */
export function postFormDataWithUploadLifecycle(
  url: string,
  form: FormData,
  onUploadComplete: () => void,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    let uploadSignaled = false;
    const signalUpload = () => {
      if (uploadSignaled) return;
      uploadSignaled = true;
      onUploadComplete();
    };
    xhr.upload.addEventListener("load", signalUpload);
    xhr.upload.addEventListener("error", () => {
      /* response handler still runs */
    });
    xhr.addEventListener("load", () => {
      signalUpload();
      const raw = xhr.response;
      const data =
        raw && typeof raw === "object"
          ? (raw as Record<string, unknown>)
          : {};
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    });
    xhr.addEventListener("error", () => {
      reject(new Error("Network error"));
    });
    xhr.addEventListener("abort", () => {
      reject(new Error("Request aborted"));
    });
    xhr.send(form);
  });
}
