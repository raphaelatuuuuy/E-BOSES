from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ImageDetectionResult:
    objects: list[dict]
    confidence: float | None
    model_version: str


class ImageDetectorNotConfigured(RuntimeError):
    pass


class YoloImageDetector:
    def __init__(self, model_path: str):
        self.model_path = model_path

    def detect(self, image_paths: list[str]) -> ImageDetectionResult:
        if not self.model_path or not Path(self.model_path).exists():
            raise ImageDetectorNotConfigured("YOLOv8 model path is not configured.")
        if not image_paths:
            return ImageDetectionResult(objects=[], confidence=None, model_version=Path(self.model_path).name)

        from ultralytics import YOLO

        model = YOLO(self.model_path)
        detected: list[dict] = []
        confidences: list[float] = []
        for image_path in image_paths:
            for result in model(image_path, verbose=False):
                names = result.names
                for box in result.boxes:
                    confidence = float(box.conf[0])
                    class_id = int(box.cls[0])
                    confidences.append(confidence)
                    detected.append({
                        "label": names.get(class_id, str(class_id)),
                        "confidence": confidence,
                        "source": Path(image_path).name,
                    })
        avg = sum(confidences) / len(confidences) if confidences else None
        return ImageDetectionResult(objects=detected, confidence=avg, model_version=Path(self.model_path).name)
