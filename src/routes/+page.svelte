<script lang="ts">
import { onMount } from 'svelte';
import { base } from '$app/paths';
import { watermarks, type Watermark, type TextWatermark, type ImageWatermark } from '$lib/watermarks';
import { cropRatios, getExportCrop } from '$lib/crops';

const MIN_WATERMARK_SCALE = 0.05;
const MAX_WATERMARK_SCALE = 5;
const HANDLE_SIZE = 14;

type WatermarkInstance = {
	id: string;
	watermark: Watermark;
	img: HTMLImageElement | null;
	x: number;
	y: number;
	scale: number;
};

let uploadedImage = $state<HTMLImageElement | null>(null);
let selectedWatermark = $state<Watermark>(watermarks[0]);
let watermarkInstances = $state<WatermarkInstance[]>([]);
let activeWatermarkId = $state<string | null>(null);
let canvas = $state<HTMLCanvasElement | null>(null);
let ctx = $state<CanvasRenderingContext2D | null>(null);
	let isDragging = $state(false);
	let dragStartX = $state(0);
	let dragStartY = $state(0);
	let activePointerId = $state<number | null>(null);
	let isResizingWatermark = $state(false);
	let resizeHandle = $state<ResizeHandle>(null);
	let resizeAnchorX = $state(0);
	let resizeAnchorY = $state(0);
	let resizeSignX = $state(1);
	let resizeSignY = $state(1);
	let hoveredHandle = $state<ResizeHandle>(null);
	let canvasCursor = $state('default');

	// Track which crop overlays are visible - 16:9 selected by default
	let visibleCrops = $state<Set<number>>(new Set([0]));

	// Crop repositioning
	let cropOffsetX = $state(0);
	let cropOffsetY = $state(0);
	let isDraggingWatermark = $state(false);
	let isHoveringWatermark = $state(false);
	let isDraggingFile = $state(false);
	let isHelpExpanded = $state(false);
	let customLogos = $state<WatermarkInstance[]>([]);

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | null;

	function getExportCropFrame(image: HTMLImageElement) {
		const exportCrop = getExportCrop();
		const cropAspectRatio = exportCrop.width / exportCrop.height;
		const imageAspectRatio = image.width / image.height;

		let cropWidth, cropHeight;
		if (cropAspectRatio > imageAspectRatio) {
			cropWidth = image.width;
			cropHeight = image.width / cropAspectRatio;
		} else {
			cropHeight = image.height;
			cropWidth = image.height * cropAspectRatio;
		}

		const cropX = (image.width - cropWidth) / 2;
		const cropY = (image.height - cropHeight) / 2;

		return { cropWidth, cropHeight, cropX, cropY };
	}

	function getWatermarkRect(instance: WatermarkInstance) {
		if (!instance.img) return null;

		const scaledWidth = instance.img.width * instance.scale;
		const scaledHeight = instance.img.height * instance.scale;
		const left = instance.x - scaledWidth / 2;
		const top = instance.y - scaledHeight / 2;

		return {
			left,
			top,
			right: left + scaledWidth,
			bottom: top + scaledHeight,
			width: scaledWidth,
			height: scaledHeight
		};
	}

	function getActiveWatermark(): WatermarkInstance | null {
		return watermarkInstances.find(w => w.id === activeWatermarkId) ?? null;
	}

	function getHandleAt(x: number, y: number): ResizeHandle {
		const activeWatermark = getActiveWatermark();
		if (!activeWatermark) return null;

		const rect = getWatermarkRect(activeWatermark);
		if (!rect) return null;

		const handles = {
			nw: { x: rect.left, y: rect.top },
			ne: { x: rect.right, y: rect.top },
			sw: { x: rect.left, y: rect.bottom },
			se: { x: rect.right, y: rect.bottom }
		};

		const hitRadius = HANDLE_SIZE;
		for (const key of Object.keys(handles) as Array<Exclude<ResizeHandle, null>>) {
			const handle = handles[key];
			if (Math.abs(x - handle.x) <= hitRadius && Math.abs(y - handle.y) <= hitRadius) {
				return key;
			}
		}

		return null;
	}

	function getHandleCursor(handle: ResizeHandle) {
		if (handle === 'nw' || handle === 'se') return 'nwse-resize';
		if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
		return 'default';
	}

	function updateCanvasCursor() {
		if (isResizingWatermark && resizeHandle) {
			canvasCursor = getHandleCursor(resizeHandle);
			return;
		}
		if (hoveredHandle) {
			canvasCursor = getHandleCursor(hoveredHandle);
			return;
		}
		if (isHoveringWatermark) {
			canvasCursor = 'move';
			return;
		}
		canvasCursor = 'default';
	}

	function getPointerInImage(event: PointerEvent, allowOutside = false) {
		if (!canvas) return null;

		const rect = canvas.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;

		const canvasAspect = canvas.width / canvas.height;
		const rectAspect = rect.width / rect.height;

		let renderWidth, renderHeight;
		if (canvasAspect > rectAspect) {
			renderWidth = rect.width;
			renderHeight = rect.width / canvasAspect;
		} else {
			renderHeight = rect.height;
			renderWidth = rect.height * canvasAspect;
		}

		const offsetX = (rect.width - renderWidth) / 2;
		const offsetY = (rect.height - renderHeight) / 2;

		let x = event.clientX - rect.left - offsetX;
		let y = event.clientY - rect.top - offsetY;

		if (!allowOutside && (x < 0 || y < 0 || x > renderWidth || y > renderHeight)) {
			return null;
		}

		x = Math.max(0, Math.min(renderWidth, x));
		y = Math.max(0, Math.min(renderHeight, y));

		return {
			x: x * (canvas.width / renderWidth),
			y: y * (canvas.height / renderHeight)
		};
	}

function getDefaultWatermarkWidthPercent(watermark: Watermark) {
	if (watermark.type === 'none') {
		return 0;
	}

	if (watermark.type === 'text') {
		return 0.45;
	}

	if (isFullWidthBanner(watermark)) {
		return 1;
	}

	if (isParlons(watermark)) {
		return 0.25;
	}

	if (isImageWatermark(watermark) && watermark.file.includes('decrypte')) {
		return 0.12;
	}

	if (isLive(watermark)) {
		return 0.25;
	}

	return 0.26;
}

function getDefaultWatermarkX(
	watermark: Watermark,
	imageWidth: number,
	cropX: number,
	cropWidth: number,
	cropHeight: number,
	scaledWidth: number
) {
	if (watermark.type === 'text') {
		return cropX + cropWidth * 0.75;
	}

	if (isFullWidthBanner(watermark)) {
		return imageWidth / 2;
	}

	if (isImageWatermark(watermark) && watermark.file.includes('live_gauche')) {
		return scaledWidth / 2;
	}

	if (isImageWatermark(watermark) && watermark.file.includes('live_centre')) {
		return imageWidth / 2;
	}

	if (isImageWatermark(watermark) && watermark.file.includes('live_droite')) {
		return imageWidth - scaledWidth / 2;
	}

	// Top-right logos: equal padding from right edge and top edge
	// Use min(cropWidth, cropHeight) so padding is visually equal in both directions
	const edgePadding = Math.min(cropWidth, cropHeight) * 0.06;
	return cropX + cropWidth - scaledWidth / 2 - edgePadding;
}

function getDefaultWatermarkY(
	watermark: Watermark,
	cropY: number,
	cropWidth: number,
	cropHeight: number,
	imageHeight: number,
	scaledHeight: number
) {
	if (isFullWidthBanner(watermark)) {
		return imageHeight - scaledHeight / 2;
	}

	// Place close to top edge — same padding as X for equal spacing
	const edgePadding = Math.min(cropWidth, cropHeight) * 0.06;
	return cropY + scaledHeight / 2 + edgePadding;
}

function isImageWatermark(watermark: Watermark): watermark is ImageWatermark {
	return !!watermark && (watermark.type === 'image' || watermark.type === undefined);
}

function isParlons(watermark: Watermark) {
	return isImageWatermark(watermark) && watermark.file?.includes('Parlons_solutions');
}

function isFullWidthBanner(watermark: Watermark) {
	return isImageWatermark(watermark) &&
		(watermark.file?.includes('opinion_bandeau') || watermark.file?.includes('enquete'));
}

function isLive(watermark: Watermark) {
	return isImageWatermark(watermark) &&
		(watermark.file?.includes('live_gauche') || watermark.file?.includes('live_centre') || watermark.file?.includes('live_droite'));
}

	function loadImageFromFile(file: File) {
		if (file && file.type.startsWith('image/')) {
			const reader = new FileReader();
			reader.onload = (e) => {
				const img = new Image();
				img.onload = () => {
					uploadedImage = img;

					// Reposition all existing watermarks for the new image
					watermarkInstances.forEach(instance => {
						repositionWatermarkForImage(instance, img);
					});

					drawCanvas();
				};
				img.src = e.target?.result as string;
			};
			reader.readAsDataURL(file);
		}
	}

	function repositionWatermarkForImage(instance: WatermarkInstance, img: HTMLImageElement) {
		if (!instance.img) return;

		const { cropWidth, cropHeight, cropX, cropY } = getExportCropFrame(img);
		const isBanner = isFullWidthBanner(instance.watermark);

		// Scale watermark relative to crop frame width for consistency
		if (isBanner) {
			instance.scale = img.width / instance.img.width;
		} else {
			const targetRatio = getDefaultWatermarkWidthPercent(instance.watermark);
			instance.scale = (cropWidth * targetRatio) / instance.img.width;
			instance.scale = Math.min(MAX_WATERMARK_SCALE, Math.max(MIN_WATERMARK_SCALE, instance.scale));
		}

		const scaledWidth = instance.img.width * instance.scale;
		const scaledHeight = instance.img.height * instance.scale;

		const targetX = getDefaultWatermarkX(
			instance.watermark,
			img.width,
			cropX,
			cropWidth,
			cropHeight,
			scaledWidth
		);
		const targetY = getDefaultWatermarkY(
			instance.watermark,
			cropY,
			cropWidth,
			cropHeight,
			img.height,
			scaledHeight
		);
		const halfWidth = scaledWidth / 2;
		const halfHeight = scaledHeight / 2;

		instance.x = Math.max(halfWidth, Math.min(img.width - halfWidth, targetX));
		instance.y = Math.max(halfHeight, Math.min(img.height - halfHeight, targetY));
	}

	function handleImageUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) loadImageFromFile(file);
	}

function handleDragOver(event: DragEvent) {
	event.preventDefault();
	isDraggingFile = true;
}

function handleDragLeave(event: DragEvent) {
	event.preventDefault();
	isDraggingFile = false;
}

function handleDrop(event: DragEvent) {
	event.preventDefault();
	isDraggingFile = false;

	const file = event.dataTransfer?.files[0];
	if (file) loadImageFromFile(file);
}

	function ensureWatermarkFont(watermark: TextWatermark) {
		if (typeof document !== 'undefined' && document.fonts) {
			const fontFamily = watermark.font ?? 'Montserrat';
			const fontWeight = watermark.fontWeight ?? 700;
			return document.fonts.load(`${fontWeight} 80px "${fontFamily}"`);
		}
		return Promise.resolve();
	}

	function createTextWatermarkImage(watermark: TextWatermark) {
		return new Promise<HTMLImageElement>(async (resolve) => {
			await ensureWatermarkFont(watermark);

			const canvasElement = document.createElement('canvas');
			const canvasCtx = canvasElement.getContext('2d');
			if (!canvasCtx) {
				resolve(new Image());
				return;
			}

			const fontFamily = watermark.font ?? 'Montserrat';
			const fontWeight = watermark.fontWeight ?? 700;
			const fontSize = 96;
			const padding = watermark.padding ?? 20;

			canvasCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
			canvasCtx.textBaseline = 'top';

			const metrics = canvasCtx.measureText(watermark.text);
			const textHeight =
				(metrics.actualBoundingBoxAscent || fontSize) + (metrics.actualBoundingBoxDescent || fontSize * 0.2);

			canvasElement.width = Math.ceil(metrics.width + padding * 2);
			canvasElement.height = Math.ceil(textHeight + padding * 2);

			canvasCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
			canvasCtx.textBaseline = 'top';
			canvasCtx.fillStyle = watermark.color ?? 'white';

			if (watermark.shadowColor) {
				canvasCtx.shadowColor = watermark.shadowColor;
				canvasCtx.shadowBlur = watermark.shadowBlur ?? 0;
				canvasCtx.shadowOffsetX = 0;
				canvasCtx.shadowOffsetY = 0;
			}

			const textX = padding;
			const textY = padding;

			if (watermark.outlineWidth && watermark.outlineColor) {
				canvasCtx.lineWidth = watermark.outlineWidth;
				canvasCtx.strokeStyle = watermark.outlineColor;
				canvasCtx.strokeText(watermark.text, textX, textY);
			}

			canvasCtx.fillText(watermark.text, textX, textY);

			const img = new Image();
			img.onload = () => resolve(img);
			img.src = canvasElement.toDataURL('image/png');
		});
	}

	function isSameWatermark(w1: Watermark, w2: Watermark): boolean {
		if (w1.type !== w2.type) return false;
		if (w1.type === 'text' && w2.type === 'text') {
			return w1.text === w2.text;
		}
		if (isImageWatermark(w1) && isImageWatermark(w2)) {
			return w1.file === w2.file;
		}
		return false;
	}

	async function handleCustomLogoUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !file.type.startsWith('image/png')) {
			alert('Veuillez sélectionner un fichier PNG');
			return;
		}

		const reader = new FileReader();
		reader.onload = async (e) => {
			const img = new Image();
			img.onload = () => {
				// Create a custom watermark definition
				const customWatermark: ImageWatermark = {
					name: file.name.replace('.png', ''),
					file: '', // Not used for custom logos
					type: 'image',
					opacity: 1
				};

				// Generate unique ID
				const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

				// Calculate default position and scale relative to crop width
				let x = 50, y = 50, scale = 0.15;

				if (uploadedImage) {
					const { cropWidth, cropHeight, cropX, cropY } = getExportCropFrame(uploadedImage);
					const defaultScale = (cropWidth * 0.15) / img.width;
					scale = Math.min(MAX_WATERMARK_SCALE, Math.max(MIN_WATERMARK_SCALE, defaultScale));

					const scaledWidth = img.width * scale;
					const scaledHeight = img.height * scale;
					const halfWidth = scaledWidth / 2;
					const halfHeight = scaledHeight / 2;

					const targetX = getDefaultWatermarkX(customWatermark, uploadedImage.width, cropX, cropWidth, cropHeight, scaledWidth);
					const targetY = getDefaultWatermarkY(
						customWatermark,
						cropY,
						cropWidth,
						cropHeight,
						uploadedImage.height,
						scaledHeight
					);

					x = Math.max(halfWidth, Math.min(uploadedImage.width - halfWidth, targetX));
					y = Math.max(halfHeight, Math.min(uploadedImage.height - halfHeight, targetY));
				}

				const newInstance: WatermarkInstance = { id, watermark: customWatermark, img, x, y, scale };
				customLogos = [...customLogos, newInstance];
				watermarkInstances = [...watermarkInstances, newInstance];
				activeWatermarkId = id;

				drawCanvas();
			};
			img.src = e.target?.result as string;
		};
		reader.readAsDataURL(file);

		// Reset input so the same file can be uploaded again
		input.value = '';
	}

	async function toggleWatermark(watermark: Watermark) {
		if (watermark.type === 'none') return;

		// Check if this watermark is already added
		const existingIndex = watermarkInstances.findIndex(w => isSameWatermark(w.watermark, watermark));

		if (existingIndex !== -1) {
			// Remove it
			const removed = watermarkInstances[existingIndex];
			watermarkInstances = watermarkInstances.filter((_, i) => i !== existingIndex);
			if (activeWatermarkId === removed.id) {
				activeWatermarkId = watermarkInstances.length > 0 ? watermarkInstances[0].id : null;
			}
		} else {
			// Add it
			let img: HTMLImageElement;
			if (watermark.type === 'text') {
				img = await createTextWatermarkImage(watermark);
			} else {
				img = await new Promise<HTMLImageElement>((resolve) => {
					const imgElement = new Image();
					imgElement.onload = () => resolve(imgElement);
					imgElement.src = `${base}/${watermark.file}`;
				});
			}

			// Generate unique ID
			const id = `watermark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

			// Calculate default position and scale relative to crop width
			let x = 50, y = 50, scale = 0.15;

			if (uploadedImage) {
				const { cropWidth, cropHeight, cropX, cropY } = getExportCropFrame(uploadedImage);
				const isBanner = isFullWidthBanner(watermark);
				const targetRatio = getDefaultWatermarkWidthPercent(watermark);
				const defaultScale = isBanner
					? uploadedImage.width / img.width
					: (cropWidth * targetRatio) / img.width;
				scale = isBanner
					? defaultScale
					: Math.min(MAX_WATERMARK_SCALE, Math.max(MIN_WATERMARK_SCALE, defaultScale));

				const scaledWidth = img.width * scale;
				const scaledHeight = img.height * scale;
				const halfWidth = scaledWidth / 2;
				const halfHeight = scaledHeight / 2;

				const targetX = getDefaultWatermarkX(watermark, uploadedImage.width, cropX, cropWidth, cropHeight, scaledWidth);
				const targetY = getDefaultWatermarkY(
					watermark,
					cropY,
					cropWidth,
					cropHeight,
					uploadedImage.height,
					scaledHeight
				);

				x = Math.max(halfWidth, Math.min(uploadedImage.width - halfWidth, targetX));
				y = Math.max(halfHeight, Math.min(uploadedImage.height - halfHeight, targetY));
			}

			const newInstance: WatermarkInstance = { id, watermark, img, x, y, scale };
			watermarkInstances = [...watermarkInstances, newInstance];
			activeWatermarkId = id;
		}

		drawCanvas();
	}

	function drawCanvas() {
		if (!canvas || !ctx || !uploadedImage) return;

		canvas.width = uploadedImage.width;
		canvas.height = uploadedImage.height;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(uploadedImage, 0, 0);

		// Draw all watermarks
		watermarkInstances.forEach(instance => {
			const watermarkRect = getWatermarkRect(instance);
			if (!instance.img || !watermarkRect) return;

			const watermarkOpacity = instance.watermark.type === 'text' ? 1 :
				(isImageWatermark(instance.watermark) ? instance.watermark.opacity ?? 1 : 1);
			ctx.save();
			ctx.globalAlpha = watermarkOpacity;
			ctx.drawImage(
				instance.img,
				watermarkRect.left,
				watermarkRect.top,
				watermarkRect.width,
				watermarkRect.height
			);
			ctx.restore();

			// Draw selection frame and handles only for active watermark
			const isActive = instance.id === activeWatermarkId;
			if (isActive) {
				ctx.save();
				// Draw selection frame
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
				ctx.lineWidth = 2;
				ctx.setLineDash([6, 4]);
				ctx.strokeRect(watermarkRect.left, watermarkRect.top, watermarkRect.width, watermarkRect.height);
				ctx.setLineDash([]);

				// Draw handles
				const handleHalf = HANDLE_SIZE / 2;
				const handles = [
					{ x: watermarkRect.left, y: watermarkRect.top },
					{ x: watermarkRect.right, y: watermarkRect.top },
					{ x: watermarkRect.left, y: watermarkRect.bottom },
					{ x: watermarkRect.right, y: watermarkRect.bottom }
				];
				ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
				ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
				handles.forEach(({ x, y }) => {
					ctx.fillRect(x - handleHalf, y - handleHalf, HANDLE_SIZE, HANDLE_SIZE);
					ctx.strokeRect(x - handleHalf, y - handleHalf, HANDLE_SIZE, HANDLE_SIZE);
				});

				// Draw move icon only on hover/drag
				if (isHoveringWatermark || isDraggingWatermark || isResizingWatermark) {
					const cx = watermarkRect.left + watermarkRect.width / 2;
					const cy = watermarkRect.top + watermarkRect.height / 2;
					const arm = 14;
					const head = 5;

					ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
					ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
					ctx.lineWidth = 2;

					ctx.beginPath();
					ctx.moveTo(cx - arm, cy);
					ctx.lineTo(cx + arm, cy);
					ctx.moveTo(cx, cy - arm);
					ctx.lineTo(cx, cy + arm);
					ctx.stroke();

					// Arrowheads
					ctx.beginPath();
					ctx.moveTo(cx - arm, cy);
					ctx.lineTo(cx - arm + head, cy - head);
					ctx.lineTo(cx - arm + head, cy + head);
					ctx.closePath();
					ctx.fill();

					ctx.beginPath();
					ctx.moveTo(cx + arm, cy);
					ctx.lineTo(cx + arm - head, cy - head);
					ctx.lineTo(cx + arm - head, cy + head);
					ctx.closePath();
					ctx.fill();

					ctx.beginPath();
					ctx.moveTo(cx, cy - arm);
					ctx.lineTo(cx - head, cy - arm + head);
					ctx.lineTo(cx + head, cy - arm + head);
					ctx.closePath();
					ctx.fill();

					ctx.beginPath();
					ctx.moveTo(cx, cy + arm);
					ctx.lineTo(cx - head, cy + arm - head);
					ctx.lineTo(cx + head, cy + arm - head);
					ctx.closePath();
					ctx.fill();
				}
				ctx.restore();
			}
		});

		// Draw crop overlays
		visibleCrops.forEach((cropIndex) => {
			const crop = cropRatios[cropIndex];
			if (!crop) return;

			// Calculate aspect ratios
			const cropAspectRatio = crop.width / crop.height;
			const imageAspectRatio = uploadedImage.width / uploadedImage.height;

			let cropWidth, cropHeight;

			// Scale crop to fit the image while maintaining aspect ratio
			// This simulates "cover" behavior - show what would be kept in the final crop
			if (cropAspectRatio > imageAspectRatio) {
				// Crop is wider - fit to image width
				cropWidth = uploadedImage.width;
				cropHeight = uploadedImage.width / cropAspectRatio;
			} else {
				// Crop is taller - fit to image height
				cropHeight = uploadedImage.height;
				cropWidth = uploadedImage.height * cropAspectRatio;
			}

			// Center the crop + user offset (only for export crop)
			const offsetX = crop.isExportCrop ? cropOffsetX : 0;
			const offsetY = crop.isExportCrop ? cropOffsetY : 0;
			const cropX = (uploadedImage.width - cropWidth) / 2 + offsetX;
			const cropY = (uploadedImage.height - cropHeight) / 2 + offsetY;

			// Draw darkened area outside crop (what will be cropped out)
			ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';

			// Top
			if (cropY > 0) {
				ctx.fillRect(0, 0, uploadedImage.width, cropY);
			}
			// Bottom
			if (cropY + cropHeight < uploadedImage.height) {
				ctx.fillRect(0, cropY + cropHeight, uploadedImage.width, uploadedImage.height - (cropY + cropHeight));
			}
			// Left
			if (cropX > 0) {
				ctx.fillRect(0, cropY, cropX, cropHeight);
			}
			// Right
			if (cropX + cropWidth < uploadedImage.width) {
				ctx.fillRect(cropX + cropWidth, cropY, uploadedImage.width - (cropX + cropWidth), cropHeight);
			}

			// Draw crop boundary
			ctx.strokeStyle = crop.color;
			ctx.lineWidth = 4;
			ctx.setLineDash([15, 10]);
			ctx.strokeRect(cropX, cropY, cropWidth, cropHeight);
			ctx.setLineDash([]);

			// Draw label with background
			const labelText = crop.name;
			ctx.font = 'bold 28px Arial';
			const textMetrics = ctx.measureText(labelText);
			const labelPadding = 10;
			const labelX = cropX + 15;
			const labelY = cropY + 20;

			// Label background
			ctx.fillStyle = crop.color;
			ctx.fillRect(labelX - labelPadding, labelY - 28, textMetrics.width + labelPadding * 2, 40);

			// Label text
			ctx.fillStyle = 'white';
			ctx.fillText(labelText, labelX, labelY);
		});
	}

	function toggleCrop(index: number) {
		if (visibleCrops.has(index)) {
			visibleCrops.delete(index);
		} else {
			visibleCrops.add(index);
		}
		visibleCrops = visibleCrops; // Trigger reactivity
		drawCanvas();
	}

	function findWatermarkAtPoint(mouseX: number, mouseY: number): WatermarkInstance | null {
		// Check watermarks in reverse order (top to bottom)
		for (let i = watermarkInstances.length - 1; i >= 0; i--) {
			const instance = watermarkInstances[i];
			const rect = getWatermarkRect(instance);
			if (!rect) continue;

			if (mouseX >= rect.left && mouseX <= rect.right &&
				mouseY >= rect.top && mouseY <= rect.bottom) {
				return instance;
			}
		}
		return null;
	}

	function handlePointerDown(event: PointerEvent) {
		if (!canvas || !uploadedImage) return;

		activePointerId = event.pointerId;
		canvas.setPointerCapture(event.pointerId);

		const mouse = getPointerInImage(event);
		if (!mouse) return;

		isDragging = true;
		const handle = getHandleAt(mouse.x, mouse.y);
		if (handle) {
			const activeWatermark = getActiveWatermark();
			if (!activeWatermark) return;

			const rect = getWatermarkRect(activeWatermark);
			if (!rect) return;

			isResizingWatermark = true;
			resizeHandle = handle;
			hoveredHandle = handle;

			if (handle === 'se') {
				resizeAnchorX = rect.left;
				resizeAnchorY = rect.top;
				resizeSignX = 1;
				resizeSignY = 1;
			} else if (handle === 'ne') {
				resizeAnchorX = rect.left;
				resizeAnchorY = rect.bottom;
				resizeSignX = 1;
				resizeSignY = -1;
			} else if (handle === 'sw') {
				resizeAnchorX = rect.right;
				resizeAnchorY = rect.top;
				resizeSignX = -1;
				resizeSignY = 1;
			} else {
				resizeAnchorX = rect.right;
				resizeAnchorY = rect.bottom;
				resizeSignX = -1;
				resizeSignY = -1;
			}
			updateCanvasCursor();
			return;
		}

		const clickedWatermark = findWatermarkAtPoint(mouse.x, mouse.y);
		isDraggingWatermark = clickedWatermark !== null;

		if (isDraggingWatermark && clickedWatermark) {
			// Set as active and prepare to move
			activeWatermarkId = clickedWatermark.id;
			dragStartX = mouse.x - clickedWatermark.x;
			dragStartY = mouse.y - clickedWatermark.y;
			drawCanvas(); // Redraw to show new selection
		} else {
			// Moving crop frame
			dragStartX = mouse.x - cropOffsetX;
			dragStartY = mouse.y - cropOffsetY;
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (!canvas || !uploadedImage) return;
		if (activePointerId !== null && event.pointerId !== activePointerId) return;

		const mouse = getPointerInImage(event, isDragging);
		const handle = mouse ? getHandleAt(mouse.x, mouse.y) : null;
		hoveredHandle = handle;
		isHoveringWatermark = mouse ? findWatermarkAtPoint(mouse.x, mouse.y) !== null : false;
		updateCanvasCursor();
		if (!isDragging || !mouse) return;

		const activeWatermark = getActiveWatermark();

		if (isResizingWatermark && resizeHandle && activeWatermark && activeWatermark.img) {
			const anchorX = resizeAnchorX;
			const anchorY = resizeAnchorY;
			const rawWidth = Math.abs(mouse.x - anchorX);
			const rawHeight = Math.abs(mouse.y - anchorY);
			let scale = Math.min(rawWidth / activeWatermark.img.width, rawHeight / activeWatermark.img.height);
			scale = Math.max(MIN_WATERMARK_SCALE, Math.min(MAX_WATERMARK_SCALE, scale));

			const newWidth = activeWatermark.img.width * scale;
			const newHeight = activeWatermark.img.height * scale;
			let centerX = anchorX + resizeSignX * (newWidth / 2);
			let centerY = anchorY + resizeSignY * (newHeight / 2);

			const halfWidth = newWidth / 2;
			const halfHeight = newHeight / 2;
			centerX = Math.max(halfWidth, Math.min(uploadedImage.width - halfWidth, centerX));
			centerY = Math.max(halfHeight, Math.min(uploadedImage.height - halfHeight, centerY));

			activeWatermark.scale = scale;
			activeWatermark.x = centerX;
			activeWatermark.y = centerY;
		} else if (isDraggingWatermark && activeWatermark && activeWatermark.img) {
			// Moving watermark with boundary constraints
			const scaledWidth = activeWatermark.img.width * activeWatermark.scale;
			const scaledHeight = activeWatermark.img.height * activeWatermark.scale;
			const halfWidth = scaledWidth / 2;
			const halfHeight = scaledHeight / 2;

			// Calculate new position
			const newX = mouse.x - dragStartX;
			const newY = mouse.y - dragStartY;

			// Clamp to image boundaries
			activeWatermark.x = Math.max(halfWidth, Math.min(uploadedImage.width - halfWidth, newX));
			activeWatermark.y = Math.max(halfHeight, Math.min(uploadedImage.height - halfHeight, newY));
		} else {
			// Moving crop frame with boundary constraints
			const exportCrop = getExportCrop();
			const cropAspectRatio = exportCrop.width / exportCrop.height;
			const imageAspectRatio = uploadedImage.width / uploadedImage.height;

			let cropWidth, cropHeight;
			if (cropAspectRatio > imageAspectRatio) {
				cropWidth = uploadedImage.width;
				cropHeight = uploadedImage.width / cropAspectRatio;
			} else {
				cropHeight = uploadedImage.height;
				cropWidth = uploadedImage.height * cropAspectRatio;
			}

			// Calculate max allowed offset
			const maxOffsetX = (uploadedImage.width - cropWidth) / 2;
			const maxOffsetY = (uploadedImage.height - cropHeight) / 2;

			// Clamp offset to keep crop within image bounds
			const newOffsetX = mouse.x - dragStartX;
			const newOffsetY = mouse.y - dragStartY;

			cropOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX));
			cropOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY));
		}

		drawCanvas();
	}

	function handlePointerUp(event: PointerEvent) {
		if (!canvas) return;
		if (activePointerId !== null && event.pointerId !== activePointerId) return;

		isDragging = false;
		activePointerId = null;
		isResizingWatermark = false;
		resizeHandle = null;
		isHoveringWatermark = false;
		hoveredHandle = null;
		updateCanvasCursor();
		canvas.releasePointerCapture(event.pointerId);
	}

	function downloadImage() {
		if (!uploadedImage) return;

		const exportCrop = getExportCrop();

		// Calculate export crop dimensions (same logic as drawing)
		const cropAspectRatio = exportCrop.width / exportCrop.height;
		const imageAspectRatio = uploadedImage.width / uploadedImage.height;

		let cropWidth, cropHeight;
		if (cropAspectRatio > imageAspectRatio) {
			cropWidth = uploadedImage.width;
			cropHeight = uploadedImage.width / cropAspectRatio;
		} else {
			cropHeight = uploadedImage.height;
			cropWidth = uploadedImage.height * cropAspectRatio;
		}

		const cropX = (uploadedImage.width - cropWidth) / 2 + cropOffsetX;
		const cropY = (uploadedImage.height - cropHeight) / 2 + cropOffsetY;

		// Create export canvas
		const exportCanvas = document.createElement('canvas');
		exportCanvas.width = exportCrop.width;
		exportCanvas.height = exportCrop.height;
		const exportCtx = exportCanvas.getContext('2d');
		if (!exportCtx) return;

		// Draw cropped image
		exportCtx.drawImage(
			uploadedImage,
			cropX, cropY, cropWidth, cropHeight,  // Source rectangle
			0, 0, exportCrop.width, exportCrop.height  // Destination rectangle
		);

		// Draw all watermarks
		watermarkInstances.forEach(instance => {
			if (!instance.img || instance.watermark.type === 'none') return;

			// Calculate watermark position relative to crop
			const watermarkRelX = instance.x - cropX;
			const watermarkRelY = instance.y - cropY;

			// Scale watermark position to export dimensions
			const scaleFactorX = exportCrop.width / cropWidth;
			const scaleFactorY = exportCrop.height / cropHeight;
			const exportWatermarkX = watermarkRelX * scaleFactorX;
			const exportWatermarkY = watermarkRelY * scaleFactorY;

			// Scale watermark size
			const exportWatermarkWidth = instance.img.width * instance.scale * scaleFactorX;
			const exportWatermarkHeight = instance.img.height * instance.scale * scaleFactorY;

			// Draw watermark
			const exportWatermarkOpacity = instance.watermark.type === 'text' ? 1 :
				(isImageWatermark(instance.watermark) ? instance.watermark.opacity ?? 1 : 1);
			exportCtx.save();
			exportCtx.globalAlpha = exportWatermarkOpacity;
			exportCtx.drawImage(
				instance.img,
				exportWatermarkX - exportWatermarkWidth / 2,
				exportWatermarkY - exportWatermarkHeight / 2,
				exportWatermarkWidth,
				exportWatermarkHeight
			);
			exportCtx.restore();
		});

		// Export as JPEG
		exportCanvas.toBlob(
			(blob) => {
				if (blob) {
					const url = URL.createObjectURL(blob);
					const link = document.createElement('a');
					link.download = 'image-filigranee.jpg';
					link.href = url;
					link.click();
					URL.revokeObjectURL(url);
				}
			},
			'image/jpeg',
			0.85
		);
	}

	$effect(() => {
		if (canvas) {
			ctx = canvas.getContext('2d');
		}
	});

	// Draw canvas whenever image or watermark changes
	$effect(() => {
		if (uploadedImage && canvas && ctx) {
			drawCanvas();
		}
	});

	onMount(() => {
		// Initialize with empty watermarks
	});
</script>

	<div class="container">
		<h1>Ajoutez un filigrane à vos images</h1>

	{#if uploadedImage}
		<div class="workspace">
			<div class="side-panel">
				<div class="card watermark-card">
					<div class="card-header">
						<div>
							<p class="eyebrow">Filigrane</p>
							<h3>Ajoutez des logos</h3>
						</div>
						<span class="hint">Cliquez pour ajouter/retirer</span>
					</div>
					<div class="watermark-grid">
						{#each watermarks.filter(w => w.type !== 'none') as watermark}
							{@const isAdded = watermarkInstances.some(i => isSameWatermark(i.watermark, watermark))}
							<button
								class="watermark-preview-wrapper"
								class:added={isAdded}
								onclick={() => toggleWatermark(watermark)}
								aria-label={isAdded ? `Retirer ${watermark.name}` : `Ajouter ${watermark.name}`}
							>
								<div
									class="watermark-preview"
									class:added={isAdded}
								>
									{#if watermark.type === 'text'}
										<span class="watermark-text-preview">{watermark.text}</span>
									{:else if isImageWatermark(watermark)}
										<img src="{base}/{watermark.file}" alt={watermark.name} />
									{/if}
									<span class="watermark-name">{watermark.name}</span>
								</div>
								<span
									class="toggle-watermark-btn"
									class:is-added={isAdded}
								>
									{isAdded ? '×' : '+'}
								</span>
							</button>
						{/each}

						{#each customLogos as customInstance}
							<div class="watermark-preview-wrapper">
								<button
									class="watermark-preview custom-logo"
									class:active={customInstance.id === activeWatermarkId}
									onclick={() => {
										activeWatermarkId = customInstance.id;
										drawCanvas();
									}}
								>
									{#if customInstance.img}
										<img src={customInstance.img.src} alt={customInstance.watermark.name} />
									{/if}
									<span class="watermark-name">{customInstance.watermark.name}</span>
									{#if customInstance.id === activeWatermarkId}
										<span class="active-badge">Actif</span>
									{/if}
								</button>
								<button
									class="toggle-watermark-btn is-added"
									onclick={() => {
										customLogos = customLogos.filter(c => c.id !== customInstance.id);
										watermarkInstances = watermarkInstances.filter(w => w.id !== customInstance.id);
										if (activeWatermarkId === customInstance.id) {
											activeWatermarkId = watermarkInstances.length > 0 ? watermarkInstances[0].id : null;
										}
										drawCanvas();
									}}
									aria-label="Supprimer {customInstance.watermark.name}"
								>
									×
								</button>
							</div>
						{/each}

						<div class="watermark-preview-wrapper">
							<label class="watermark-preview upload-card">
								<div class="upload-icon-large">📁</div>
								<span class="watermark-name upload-text">Ajoutez votre logo en PNG</span>
								<input
									type="file"
									accept="image/png"
									onchange={handleCustomLogoUpload}
									style="display: none;"
								/>
							</label>
						</div>
					</div>
				</div>

				<div class="card">
					<div class="card-header">
						<div>
							<p class="eyebrow">Cadres</p>
							<h3>Vérifiez vos formats</h3>
							<p class="card-subtext small">
								Le cadre rouge 16:9 indique le cadrage final de l'image téléchargée. Les cadres 1:1 et 9:16 sont
								juste là pour vérifier si vos logos entreront dans ces cadrages spécifiques imposés par Cryo.
								Aucun cadre n'apparaitra sur l'image exportée
							</p>
						</div>
					</div>
					<div class="crop-options">
						{#each cropRatios as crop, index}
							<label class="crop-chip">
								<input
									type="checkbox"
									checked={visibleCrops.has(index)}
									onchange={() => toggleCrop(index)}
								/>
								<span
									class="chip-label"
									style={`--chip-color: ${crop.color}; border-color: ${crop.color}; color: ${crop.color}`}
								>
									{crop.name}
								</span>
							</label>
						{/each}
					</div>
				</div>

				<button class="download-btn" onclick={downloadImage}>
					Télécharger l'image
				</button>
			</div>
			<div class="canvas-container">
				<div class="canvas-bar">
					<div>
						<p class="eyebrow">Aperçu</p>
						<h3>Ajustez votre filigrane</h3>
					</div>
					<button class="help-toggle" onclick={() => isHelpExpanded = !isHelpExpanded}>
						<span>Comment ça marche ?</span>
						<span class="help-icon">{isHelpExpanded ? '−' : '+'}</span>
					</button>
				</div>
				{#if isHelpExpanded}
					<div class="help-panel">
						<div class="help-item">
							<strong>🖱️ Déplacer un logo</strong>
							<p>Cliquez et glissez le logo avec votre souris. Si le logo n'est pas dans le cadre rouge, il sera coupé lors de l'export.</p>
						</div>
						<div class="help-item">
							<strong>↔️ Redimensionner un logo</strong>
							<p>Cliquez et tirez les coins du logo pour ajuster sa taille.</p>
						</div>
						<div class="help-item">
							<strong>✅ Activer un logo</strong>
							<p>Cliquez sur un logo ajouté (fond vert) dans la bibliothèque pour le sélectionner et le manipuler.</p>
						</div>
						<div class="help-item">
							<strong>📁 Ajouter vos propres logos</strong>
							<p>Cliquez sur la carte "Ajoutez votre logo en PNG" en bas de la liste pour importer vos propres logos au format PNG.</p>
						</div>
					</div>
				{/if}
				<div
					class="canvas-drop-wrapper"
					class:dragging={isDraggingFile}
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
					ondrop={handleDrop}
				>
					<canvas
						bind:this={canvas}
						onpointerdown={handlePointerDown}
						onpointermove={handlePointerMove}
						onpointerup={handlePointerUp}
						onpointercancel={handlePointerUp}
						onpointerleave={handlePointerUp}
						style={`cursor: ${canvasCursor}`}
					></canvas>
					{#if isDraggingFile}
						<div class="canvas-drop-overlay">
							<div class="overlay-icon">📁</div>
							<div class="overlay-text">Déposez une nouvelle image ici</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div
			class="drop-zone"
			class:dragging={isDraggingFile}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			role="button"
			tabindex="0"
			aria-label="Déposez ou choisissez un fichier"
		>
			<div class="drop-zone-content">
				<div class="upload-icon">📁</div>
				<h2>Glissez-déposez votre image ici</h2>
				<p class="drop-hint">ou</p>
				<label for="file-input" class="upload-button">
					Choisir une image
					<input
						id="file-input"
						type="file"
						accept="image/*"
						onchange={handleImageUpload}
						style="display: none;"
					/>
				</label>
				<p class="file-types">JPG, PNG, WEBP acceptés</p>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
		background: linear-gradient(135deg, #f7f8fb 0%, #eef1f7 100%);
		height: 100vh;
		overflow: hidden;
	}

	.container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 0.5rem;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		box-sizing: border-box;
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(320px, 420px) 1fr;
		gap: 1rem;
		flex: 1;
		min-height: 0;
		align-items: stretch;
	}

	.side-panel {
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	h1 {
		color: #1f2937;
		text-align: center;
		font-size: 1.35rem;
		margin: 0;
		padding: 0.25rem 0;
		flex-shrink: 0;
		font-weight: 800;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.7rem;
		color: #94a3b8;
		margin: 0 0 0.15rem;
	}

	.card {
		background: white;
		border-radius: 12px;
		padding: 0.9rem 1rem;
		border: 1px solid #e2e8f0;
		box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
	}

	.watermark-card {
		min-height: 0;
		display: flex;
		flex-direction: column;
		max-height: 60vh;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.65rem;
	}

	.card h3 {
		margin: 0;
		font-size: 1.05rem;
		color: #0f172a;
	}

	.card-subtext.small {
		font-size: 0.75rem;
		color: #4b5563;
		margin-top: 0.25rem;
	}

	.hint {
		color: #6b7280;
		font-size: 0.8rem;
	}

	.watermark-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.65rem;
	}

	.watermark-card .watermark-grid {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	.watermark-card .watermark-grid::-webkit-scrollbar {
		width: 8px;
	}

	.watermark-card .watermark-grid::-webkit-scrollbar-thumb {
		background: #cbd5e1;
		border-radius: 10px;
	}

	.watermark-preview-wrapper {
		position: relative;
		width: 100%;
		cursor: pointer;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		text-align: inherit;
	}

	.watermark-preview {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.55rem;
		border: 3px solid #e5e7eb;
		background: #f9fafb;
		border-radius: 10px;
		transition: all 0.2s ease;
		width: 100%;
		box-sizing: border-box;
		min-height: 110px;
		position: relative;
	}

	.watermark-preview.added {
		border-color: #10b981;
		background: #f0fdf4;
	}

	.watermark-preview-wrapper:hover .watermark-preview {
		border-color: #cbd5e1;
		background: #f8fafc;
	}

	.watermark-preview-wrapper:hover .watermark-preview.added {
		border-color: #059669;
		background: #dcfce7;
	}

	.watermark-preview.custom-logo {
		cursor: pointer;
		border: 3px solid #10b981;
		background: #f0fdf4;
	}

	.watermark-preview.custom-logo:hover {
		border-color: #059669;
		background: #dcfce7;
	}

	.watermark-preview.custom-logo.active {
		border-color: #6366f1;
		background: #eef2ff;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
	}

	.watermark-preview.upload-card {
		cursor: pointer;
		border: 3px dashed #cbd5e1;
		background: #f8fafc;
	}

	.watermark-preview.upload-card:hover {
		border-color: #6366f1;
		background: #eef2ff;
		transform: translateY(-1px);
		box-shadow: 0 3px 10px rgba(99, 102, 241, 0.15);
	}

	.upload-icon-large {
		font-size: 2.5rem;
		opacity: 0.6;
	}

	.upload-text {
		text-align: center;
		color: #6b7280;
		font-weight: 600;
	}

	.watermark-preview.upload-card:hover .upload-text {
		color: #4f46e5;
	}

	.active-badge {
		position: absolute;
		top: 6px;
		left: 6px;
		background: #6366f1;
		color: white;
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
		font-size: 0.65rem;
		font-weight: 700;
		z-index: 1;
	}

	.toggle-watermark-btn {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #10b981;
		color: white;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1.3rem;
		font-weight: bold;
		transition: all 0.2s ease;
		box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
		z-index: 2;
	}

	.toggle-watermark-btn:hover {
		transform: scale(1.1);
		box-shadow: 0 3px 10px rgba(16, 185, 129, 0.4);
	}

	.toggle-watermark-btn.is-added {
		background: #ef4444;
		box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3);
		font-size: 1.2rem;
	}

	.toggle-watermark-btn.is-added:hover {
		background: #dc2626;
		box-shadow: 0 3px 10px rgba(239, 68, 68, 0.4);
	}

	.watermark-preview img {
		width: 100%;
		height: 70px;
		object-fit: contain;
		background: #fff;
		padding: 0.35rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		box-sizing: border-box;
	}

	.watermark-text-preview {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 70px;
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
		background: #0f172a;
		color: #e2e8f0;
		font-family: 'Montserrat', sans-serif;
		font-weight: 800;
		text-transform: uppercase;
		font-size: 0.7rem;
		text-align: center;
		box-sizing: border-box;
		border: 1px solid #1f2937;
	}

	.watermark-name {
		font-size: 0.78rem;
		font-weight: 700;
		color: #111827;
		text-align: center;
	}

	.crop-options {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.5rem;
	}

	.crop-chip {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		padding: 0.45rem 0.65rem;
		border-radius: 999px;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
		transition: all 0.2s ease;
	}

	.crop-chip:hover {
		background: #eef2ff;
		border-color: #6366f1;
	}

	.crop-chip input[type="checkbox"] {
		cursor: pointer;
		width: 16px;
		height: 16px;
	}

		.chip-label {
			font-weight: 700;
			padding: 0.25rem 0.6rem;
			border-radius: 999px;
			border: 2px solid;
		background: white;
		transition: all 0.2s ease;
		font-size: 0.78rem;
		}

		.crop-chip input[type="checkbox"]:checked + .chip-label {
			background: white;
			color: var(--chip-color) !important;
			border-color: var(--chip-color);
		}

	.download-btn {
		padding: 0.75rem 1.1rem;
		background: linear-gradient(135deg, #4f46e5, #6366f1);
		color: white;
		border: none;
		border-radius: 10px;
		cursor: pointer;
		font-weight: 700;
		font-size: 0.95rem;
		transition: all 0.2s ease;
		white-space: nowrap;
		box-shadow: 0 8px 18px rgba(99, 102, 241, 0.3);
		width: 100%;
		margin-top: auto;
	}

	.download-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 10px 22px rgba(99, 102, 241, 0.35);
	}

	.canvas-container {
		background: white;
		padding: 0.5rem;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
		text-align: center;
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		overflow: hidden;
		box-sizing: border-box;
	}

	.canvas-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.canvas-bar h3 {
		margin: 0;
		font-size: 1rem;
		color: #0f172a;
	}

	.help-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: #eef2ff;
		color: #4f46e5;
		border-radius: 999px;
		padding: 0.45rem 0.75rem;
		font-weight: 700;
		font-size: 0.8rem;
		border: 2px solid #e0e7ff;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.help-toggle:hover {
		background: #e0e7ff;
		border-color: #c7d2fe;
		transform: translateY(-1px);
	}

	.help-icon {
		font-size: 1.1rem;
		font-weight: bold;
	}

	.help-panel {
		background: #fefce8;
		border: 2px solid #fde047;
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.help-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.help-item strong {
		color: #854d0e;
		font-size: 0.85rem;
	}

	.help-item p {
		margin: 0;
		color: #78716c;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	canvas {
		max-width: 100%;
		max-height: 100%;
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 6px;
		border: 1px solid #e2e8f0;
		flex: 1;
		min-height: 0;
	}

		.canvas-drop-wrapper {
			position: relative;
			border: 2px dashed transparent;
			border-radius: 8px;
			transition: border-color 0.2s ease, background-color 0.2s ease;
			flex: 1;
			display: flex;
		}

		.canvas-drop-wrapper.dragging {
			border-color: #6366f1;
			background-color: rgba(99, 102, 241, 0.08);
		}

		.canvas-drop-wrapper canvas {
			width: 100%;
			height: auto;
			object-fit: contain;
			border-radius: 6px;
			border: 1px solid #e2e8f0;
			flex: 1;
			min-height: 0;
		}

		.canvas-drop-overlay {
			position: absolute;
			inset: 0;
			background: rgba(15, 23, 42, 0.35);
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.5rem;
			color: white;
			font-weight: 700;
			backdrop-filter: blur(1px);
			border-radius: 6px;
			pointer-events: none;
		}

		.overlay-icon {
			font-size: 2rem;
		}

		.overlay-text {
			font-size: 1rem;
		}

		.drop-zone {
			background: white;
			padding: 2rem;
		border-radius: 8px;
		border: 2px dashed #cbd5e0;
		transition: all 0.3s ease;
		cursor: pointer;
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.drop-zone:hover {
		border-color: #4a5568;
		background: #f7fafc;
	}

	.drop-zone.dragging {
		border-color: #48bb78;
		background: #f0fff4;
		border-width: 3px;
	}

	.drop-zone-content {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}

	.upload-icon {
		font-size: 4rem;
		opacity: 0.5;
	}

	.drop-zone h2 {
		color: #333;
		font-size: 1.8rem;
		margin: 0;
	}

	.drop-hint {
		color: #999;
		font-size: 1rem;
		margin: 0;
		font-style: italic;
	}

	.upload-button {
		display: inline-block;
		padding: 0.875rem 2rem;
		background: #2d3748;
		color: white;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 600;
		font-size: 1rem;
		transition: all 0.2s ease;
		border: none;
	}

	.upload-button:hover {
		background: #1a202c;
	}

	.file-types {
		color: #999;
		font-size: 0.9rem;
		margin: 0;
	}
</style>
