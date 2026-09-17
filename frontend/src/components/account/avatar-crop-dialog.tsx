import { RotateCcw, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

import { GlassDialog } from "@/components/ui/glass-dialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const VIEWPORT = 260;
const OUTPUT = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_CLICK_ZOOM = 2.4;
const WHEEL_SENSITIVITY = 0.0022;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function AvatarCropDialog({
  open,
  imageUrl,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  imageUrl: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const { t } = useI18n();
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const pan = useRef<{ id: number; last: Point } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number; focal: Point } | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const live = useRef({ zoom, center, natural });
  live.current = { zoom, center, natural };

  const baseScale = natural ? Math.max(VIEWPORT / natural.width, VIEWPORT / natural.height) : 1;
  const scale = baseScale * zoom;

  useEffect(() => {
    if (open) return;
    setNatural(null);
    setZoom(1);
    setCenter({ x: 0, y: 0 });
    pointers.current.clear();
    pan.current = null;
    pinch.current = null;
    setDragging(false);
  }, [open]);

  const clampCenter = useCallback((point: Point, nextScale: number, size: Size) => {
    const half = VIEWPORT / 2 / nextScale;
    const [minX, maxX] =
      half * 2 > size.width ? [size.width / 2, size.width / 2] : [half, size.width - half];
    const [minY, maxY] =
      half * 2 > size.height ? [size.height / 2, size.height / 2] : [half, size.height - half];
    return { x: clamp(point.x, minX, maxX), y: clamp(point.y, minY, maxY) };
  }, []);

  const zoomAround = useCallback(
    (nextRaw: number, focal: Point | null) => {
      const { zoom: current, center: currentCenter, natural: size } = live.current;
      if (!size) return;
      const base = Math.max(VIEWPORT / size.width, VIEWPORT / size.height);
      const next = clamp(nextRaw, MIN_ZOOM, MAX_ZOOM);
      const point = focal ?? { x: VIEWPORT / 2, y: VIEWPORT / 2 };
      const oldScale = base * current;
      const newScale = base * next;
      const underFocal = {
        x: currentCenter.x + (point.x - VIEWPORT / 2) / oldScale,
        y: currentCenter.y + (point.y - VIEWPORT / 2) / oldScale,
      };
      setZoom(next);
      setCenter(
        clampCenter(
          {
            x: underFocal.x - (point.x - VIEWPORT / 2) / newScale,
            y: underFocal.y - (point.y - VIEWPORT / 2) / newScale,
          },
          newScale,
          size,
        ),
      );
    },
    [clampCenter],
  );

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!live.current.natural) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomAround(live.current.zoom * Math.exp(-event.deltaY * WHEEL_SENSITIVITY), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAround, natural]);

  const viewportPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!natural) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
    if (pointers.current.size === 1) {
      pan.current = { id: event.pointerId, last: { x: event.clientX, y: event.clientY } };
      pinch.current = null;
    } else if (pointers.current.size === 2) {
      pan.current = null;
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      pinch.current = {
        distance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
        zoom: live.current.zoom,
        focal: viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance;
      zoomAround(pinch.current.zoom * ratio, pinch.current.focal);
      return;
    }
    const size = live.current.natural;
    if (pan.current && pan.current.id === event.pointerId && size) {
      const dx = event.clientX - pan.current.last.x;
      const dy = event.clientY - pan.current.last.y;
      pan.current.last = { x: event.clientX, y: event.clientY };
      const current = Math.max(VIEWPORT / size.width, VIEWPORT / size.height) * live.current.zoom;
      setCenter((previous) =>
        clampCenter({ x: previous.x - dx / current, y: previous.y - dy / current }, current, size),
      );
    }
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      pan.current = null;
      pinch.current = null;
      setDragging(false);
    } else if (pointers.current.size === 1) {
      pinch.current = null;
      const [id, point] = [...pointers.current.entries()][0]!;
      pan.current = { id, last: point };
    }
  };

  const reset = () => {
    if (!natural) return;
    setZoom(1);
    setCenter({ x: natural.width / 2, y: natural.height / 2 });
  };

  const confirm = () => {
    if (!natural || !imageRef.current) return;
    const sourceSize = VIEWPORT / scale;
    const sourceX = clamp(center.x - sourceSize / 2, 0, natural.width - sourceSize);
    const sourceY = clamp(center.y - sourceSize / 2, 0, natural.height - sourceSize);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(
      imageRef.current,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      OUTPUT,
      OUTPUT,
    );
    canvas.toBlob((blob) => blob && onConfirm(blob), "image/jpeg", 0.92);
  };

  return (
    <GlassDialog
      open={open}
      onClose={onCancel}
      size="sm"
      title={t("برش عکس پروفایل")}
      description={t(
        "ناحیهٔ داخل دایره ذخیره می‌شود. عکس را بکشید، با اسکرول یا دو انگشت بزرگ کنید، یا دوبار کلیک کنید.",
      )}
    >
      <div className="grid justify-items-center gap-4">
        <div
          ref={viewportRef}
          className={cn(
            "relative touch-none select-none overflow-hidden rounded-[22px] bg-chat-ink/10",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onDoubleClick={(event) => {
            if (!natural) return;
            zoomAround(
              zoom > (MIN_ZOOM + DOUBLE_CLICK_ZOOM) / 2 ? MIN_ZOOM : DOUBLE_CLICK_ZOOM,
              viewportPoint(event.clientX, event.clientY),
            );
          }}
        >
          {imageUrl ? (
            <img
              ref={imageRef}
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute left-0 top-0 max-w-none origin-top-left"
              style={{
                width: natural ? natural.width * scale : VIEWPORT,
                height: natural ? natural.height * scale : VIEWPORT,
                transform: `translate(${VIEWPORT / 2 - center.x * scale}px, ${VIEWPORT / 2 - center.y * scale}px)`,
              }}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                setNatural({ width: naturalWidth, height: naturalHeight });
                setZoom(1);
                setCenter({ x: naturalWidth / 2, y: naturalHeight / 2 });
              }}
            />
          ) : null}
          <div
            className={cn(
              "pointer-events-none absolute inset-0 transition-opacity",
              dragging ? "opacity-100" : "opacity-0",
            )}
          >
            <span className="absolute inset-y-0 start-1/3 w-px bg-white/40" />
            <span className="absolute inset-y-0 start-2/3 w-px bg-white/40" />
            <span className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
            <span className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
          </div>
          <span className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_oklch(0.18_0.04_285/0.58)] ring-2 ring-white/70" />
        </div>

        <div className="flex w-full items-center gap-3">
          <ZoomIn className="size-4 shrink-0 text-chat-ink-soft" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!natural}
            aria-label={t("بزرگ‌نمایی")}
            onChange={(event) => zoomAround(Number(event.target.value), null)}
            className="h-1.5 flex-1 cursor-pointer accent-chat-violet"
          />
          <button
            type="button"
            onClick={reset}
            disabled={!natural}
            aria-label={t("بازنشانی برش")}
            className="grid size-8 place-items-center rounded-full border border-chat-panel-border bg-white/60 text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>

        <div className="flex w-full gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={!natural || busy}
            className="flex-1 rounded-full bg-chat-ink px-4 py-2.5 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("تأیید برش")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-chat-panel-border bg-white/60 px-4 py-2.5 text-[12px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
          >
            {t("انصراف")}
          </button>
        </div>
      </div>
    </GlassDialog>
  );
}
