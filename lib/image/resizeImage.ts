export type ResizedImageBlob = {
  blob: Blob;
  width: number;
  height: number;
};

function loadImageElement(file: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_DECODE_FAILED"));
    };
    image.src = url;
  });
}

async function decodeImage(file: Blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      console.debug("[cgmp:image] createImageBitmap failed, fallback to HTMLImageElement", error);
    }
  }

  return loadImageElement(file);
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("CANVAS_TO_BLOB_FAILED"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

export async function resizeImageToJpegBlob(file: Blob, maxSide: number, quality: number): Promise<ResizedImageBlob> {
  const startedAt = performance.now();
  const source = await decodeImage(file);
  const sourceWidth = "width" in source ? source.width : 0;
  const sourceHeight = "height" in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("IMAGE_SIZE_UNKNOWN");
  }

  const limit = Math.max(64, Number(maxSide) || 960);
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_CONTEXT_UNAVAILABLE");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  if ("close" in source && typeof source.close === "function") {
    source.close();
  }

  const blob = await canvasToBlob(canvas, "image/jpeg", quality);
  console.debug("[cgmp:image] resize completed", {
    maxSide,
    quality,
    sourceWidth,
    sourceHeight,
    width,
    height,
    size: blob.size,
    elapsedMs: Math.round(performance.now() - startedAt),
  });

  return { blob, width, height };
}
