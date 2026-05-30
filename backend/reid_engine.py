"""
Batched Re-Identification Engine
================================
Replaces the serial per-crop MobileNet extraction with a temporal-window
batch accumulator.  Crops from ALL camera streams are gathered over a
≤15 ms window, then flushed to the GPU as a single batched tensor —
dramatically cutting CUDA pipeline overhead for multi-camera setups.
"""

import threading
import cv2
import numpy as np
import torch
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image


class BatchReIDEngine:
    """Thread-safe, batched ReID feature extractor."""

    def __init__(self, device, max_batch=16, flush_interval_ms=15):
        """
        Args:
            device:            torch.device ('cuda' or 'cpu')
            max_batch:         flush immediately when queue reaches this size
            flush_interval_ms: max time (ms) to wait before flushing a partial batch
        """
        self.device = device
        self.max_batch = max_batch
        self.flush_interval = flush_interval_ms / 1000.0

        # ── Model ──────────────────────────────────────────────────────────
        self.model = models.mobilenet_v3_small(
            weights=models.MobileNet_V3_Small_Weights.DEFAULT
        ).to(device)
        self.model.eval()
        self.model.classifier = torch.nn.Identity()

        self.preprocess = transforms.Compose([
            transforms.Resize((256, 128)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                 std=[0.229, 0.224, 0.225]),
        ])

        # ── Batch queue ────────────────────────────────────────────────────
        self._queue = []                    # list of (tensor, callback)
        self._queue_lock = threading.Lock()
        self._flush_event = threading.Event()
        self._running = True

        self._worker = threading.Thread(
            target=self._batch_worker, daemon=True, name="ReID-Batch"
        )
        self._worker.start()
        print(f"[ReID Engine] Ready on {device}  "
              f"batch={max_batch}  flush={flush_interval_ms}ms")

    # ── public API ─────────────────────────────────────────────────────────

    def extract_sync(self, frame, box):
        """
        Synchronous single-crop extraction (batch-of-1).
        Used for click-to-lock where an immediate result is required.

        Returns:  np.ndarray embedding  or  None
        """
        tensor = self._crop_and_transform(frame, box)
        if tensor is None:
            return None
        try:
            batch = tensor.unsqueeze(0).to(self.device)
            with torch.no_grad():
                return self.model(batch).cpu().numpy().flatten()
        except Exception as e:
            print(f"[ReID Engine] sync error: {e}")
            return None

    def submit_async(self, frame, box, callback):
        """
        Queue a crop for batched async extraction.

        *callback(embedding_or_None)* is invoked from the batch-worker
        thread once the batch containing this crop is processed.
        """
        tensor = self._crop_and_transform(frame, box)
        if tensor is None:
            callback(None)
            return
        with self._queue_lock:
            self._queue.append((tensor, callback))
            if len(self._queue) >= self.max_batch:
                self._flush_event.set()

    # ── internals ──────────────────────────────────────────────────────────

    def _crop_and_transform(self, frame, box):
        """Crop bounding box from BGR frame → preprocessed tensor."""
        x1, y1, x2, y2 = map(int, box)
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 - x1 < 10 or y2 - y1 < 10:
            return None
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None
        pil_img = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        return self.preprocess(pil_img)

    def _batch_worker(self):
        """Drains the crop queue every ≤flush_interval and runs batched inference."""
        while self._running:
            self._flush_event.wait(timeout=self.flush_interval)
            self._flush_event.clear()

            with self._queue_lock:
                if not self._queue:
                    continue
                batch_items = list(self._queue)
                self._queue.clear()

            tensors   = [t for t, _ in batch_items]
            callbacks = [c for _, c in batch_items]

            try:
                batch_tensor = torch.stack(tensors).to(self.device)
                with torch.no_grad():
                    embeddings = self.model(batch_tensor).cpu().numpy()
                for i, cb in enumerate(callbacks):
                    try:
                        cb(embeddings[i].flatten())
                    except Exception as exc:
                        print(f"[ReID Engine] callback error: {exc}")
            except Exception as e:
                print(f"[ReID Engine] batch error: {e}")
                for cb in callbacks:
                    try:
                        cb(None)
                    except Exception:
                        pass

    def shutdown(self):
        """Graceful shutdown."""
        self._running = False
        self._flush_event.set()
        self._worker.join(timeout=2.0)
