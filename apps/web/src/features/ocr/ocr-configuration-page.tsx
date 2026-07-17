import { Navigate } from "react-router-dom"

/** Legacy route — OCR Configuration is now the Template Builder. */
export default function OcrConfigurationPage() {
  return <Navigate to="/dashboard/ocr-templates" replace />
}
