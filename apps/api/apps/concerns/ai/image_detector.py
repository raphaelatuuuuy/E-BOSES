import base64
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path


YOLOV8_COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
    "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
    "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book",
    "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]


@dataclass(frozen=True)
class ImageDetectionResult:
    objects: list[dict]
    confidence: float | None
    model_version: str
    annotated_image: str = ""


class ImageDetectorNotConfigured(RuntimeError):
    pass


class YoloImageDetector:
    def __init__(self, model_path: str):
        self.model_path = model_path

    def detect(
        self,
        image_paths: list[str],
        *,
        include_annotation: bool = False,
        supported_classes: list[str] | None = None,
        confidence_threshold: float | None = None,
    ) -> ImageDetectionResult:
        if not self.model_path or not Path(self.model_path).exists():
            raise ImageDetectorNotConfigured("YOLOv8 model path is not configured.")
        if not image_paths:
            return ImageDetectionResult(objects=[], confidence=None, model_version=Path(self.model_path).name)

        from ultralytics import YOLO

        model = YOLO(self.model_path)
        allowed = {str(label).lower() for label in (supported_classes or []) if str(label).strip()}
        class_ids = [class_id for class_id, label in model.names.items() if not allowed or str(label).lower() in allowed]
        detected: list[dict] = []
        confidences: list[float] = []
        annotated_image = ""
        for image_path in image_paths:
            for result in model(
                image_path,
                verbose=False,
                classes=class_ids if allowed else None,
                conf=confidence_threshold,
            ):
                names = result.names
                if include_annotation and not annotated_image:
                    from PIL import Image

                    plotted_bgr = result.plot(labels=True, conf=True, boxes=True)
                    annotated = Image.fromarray(plotted_bgr[..., ::-1])
                    annotated.thumbnail((1280, 1280))
                    buffer = BytesIO()
                    annotated.save(buffer, format="JPEG", quality=88, optimize=True)
                    annotated_image = f"data:image/jpeg;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}"
                for box in result.boxes:
                    confidence = float(box.conf[0])
                    class_id = int(box.cls[0])
                    label = names.get(class_id, str(class_id))
                    if allowed and str(label).lower() not in allowed:
                        continue
                    confidences.append(confidence)
                    detected.append({
                        "label": label,
                        "confidence": confidence,
                        "bbox": [round(float(value), 2) for value in box.xyxy[0].tolist()],
                        "source": Path(image_path).name,
                    })
        avg = sum(confidences) / len(confidences) if confidences else None
        return ImageDetectionResult(objects=detected, confidence=avg, model_version=Path(self.model_path).name, annotated_image=annotated_image)
