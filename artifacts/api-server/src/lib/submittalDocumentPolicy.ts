export const maxSubmittalDocumentSize = 100 * 1024 * 1024;

export const isAllowedSubmittalDocumentType = (contentType: string) =>
  contentType === "application/pdf"
  || ["image/gif", "image/jpeg", "image/png", "image/webp", "image/tiff"].includes(contentType)
  || ["text/plain", "text/csv"].includes(contentType)
  || contentType === "application/zip"
  || [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ].includes(contentType);

export const sanitizeSubmittalFileName = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()?.trim().slice(0, 255) || "submittal-document";