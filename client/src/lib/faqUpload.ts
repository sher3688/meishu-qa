/**
 * Upload a FAQ image. Prefer the configured backend storage; if the old Manus
 * storage is unavailable, store a compressed data URL with the FAQ record so
 * uploads keep working on Vercel/other deployments without Forge credentials.
 */
export async function uploadFaqImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("只支援圖片檔案");
  }

  try {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/upload", { method: "POST", body });
    if (response.ok) {
      const data = await response.json();
      if (data?.url) return data.url;
    }
  } catch {
    // Fall through to the deployment-independent fallback below.
  }

  return compressImageToDataUrl(file);
}

function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("無法讀取圖片"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("無法解析圖片"));
      img.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("瀏覽器無法處理圖片"));
        ctx.drawImage(img, 0, 0, width, height);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(type, type === "image/jpeg" ? 0.82 : undefined);
        // Keep the FAQ payload comfortably below common serverless request limits.
        if (dataUrl.length > 3_000_000) {
          return reject(new Error("圖片過大，請改用較小的圖片"));
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
