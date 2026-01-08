<script lang="ts">
import { onMount } from 'svelte';
import { base } from '$app/paths';
import { watermarks, type Watermark, type TextWatermark } from '$lib/watermarks';
import { cropRatios, getExportCrop } from '$lib/crops';

const MIN_WATERMARK_SCALE = 0.1;
const MAX_WATERMARK_SCALE = 2;
const IMAGE_DEFAULT_WATERMARK_SCALE = 0.15;
const TEXT_DEFAULT_WATERMARK_SCALE = 1;

let uploadedImage = $state<HTMLImageElement | null>(null);
let selectedWatermark = $state<Watermark>(watermarks[0]);
let watermarkImg = $state<HTMLImageElement | null>(null);
let canvas = $state<HTMLCanvasElement | null>(null);
let ctx = $state<CanvasRenderingContext2D | null>(null);

let watermarkX = $state(50);
let watermarkY = $state(50);
let watermarkScale = $state(TEXT_DEFAULT_WATERMARK_SCALE);
	let isDragging = $state(false);
	let dragStartX = $state(0);
	let dragStartY = $state(0);
	let activePointerId = $state<number | null>(null);

	// Track which crop overlays are visible - 16:9 selected by default
	let visibleCrops = $state<Set<number>>(new Set([0]));

	// Crop repositioning
	let cropOffsetX = $state(0);
	let cropOffsetY = $state(0);
	let isDraggingWatermark = $state(false);
	let isHoveringWatermark = $state(false);
	let isDraggingFile = $state(false);

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

	function getWatermarkRect() {
		if (!watermarkImg) return null;

		const scaledWidth = watermarkImg.width * watermarkScale;
		const scaledHeight = watermarkImg.height * watermarkScale;
		const left = watermarkX - scaledWidth / 2;
		const top = watermarkY - scaledHeight / 2;

		return {
			left,
			top,
			right: left + scaledWidth,
			bottom: top + scaledHeight,
			width: scaledWidth,
			height: scaledHeight
		};
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
		if (watermark.type === 'text') {
			return 0.45;
		}

		if (watermark.file.includes('opinion_bandeau')) {
			return 1;
		}

		if (watermark.file.includes('decrypte')) {
			return 0.08;
		}

		return 0.20;
	}

	function getDefaultWatermarkX(
		watermark: Watermark,
		imageWidth: number,
		cropX: number,
		cropWidth: number,
		scaledWidth: number
	) {
		const paddingXPercent = 0.25;

		if (watermark.type === 'text') {
			return cropX + cropWidth * 0.75;
		}

		if (watermark.file.includes('opinion_bandeau')) {
			return imageWidth / 2;
		}

		if (watermark.file.includes('live_gauche')) {
			return scaledWidth / 2;
		}

		if (watermark.file.includes('live_centre')) {
			return imageWidth / 2;
		}

		if (watermark.file.includes('live_droite')) {
			return imageWidth - scaledWidth / 2;
		}

		return cropX + cropWidth - cropWidth * paddingXPercent;
	}

	function getDefaultWatermarkY(
		watermark: Watermark,
		cropY: number,
		cropHeight: number,
		imageHeight: number,
		scaledHeight: number
	) {
		const topPaddingPercent = 0.12;

		if (watermark.type !== 'text' && watermark.file.includes('opinion_bandeau')) {
			return imageHeight - scaledHeight / 2;
		}

		return cropY + cropHeight * topPaddingPercent;
	}

	function isParlons(watermark: Watermark) {
		return watermark.type !== 'text' && watermark.file.includes('Parlons_solutions');
	}

	function loadImageFromFile(file: File) {
		if (file && file.type.startsWith('image/')) {
			const reader = new FileReader();
			reader.onload = (e) => {
				const img = new Image();
				img.onload = () => {
					uploadedImage = img;

					// Calculate 16:9 frame position
					const { cropWidth, cropHeight, cropX, cropY } = getExportCropFrame(img);

					let scaledWidth = 0;
					let scaledHeight = 0;
					const isOpinion = selectedWatermark.type !== 'text' &&
						selectedWatermark.file.includes('opinion_bandeau');
					const isParlonsSolution = isParlons(selectedWatermark);

					// Scale watermark relative to crop frame width for consistency
					// This ensures watermark appears same size regardless of source image resolution
					if (watermarkImg) {
						if (isOpinion) {
							watermarkScale = img.width / watermarkImg.width;
						} else if (isParlonsSolution) {
							const targetScale = 0.2;
							watermarkScale = Math.min(MAX_WATERMARK_SCALE, Math.max(MIN_WATERMARK_SCALE, targetScale));
						} else {
							const targetWatermarkWidthPercent = getDefaultWatermarkWidthPercent(selectedWatermark);
							watermarkScale = (cropWidth * targetWatermarkWidthPercent) / watermarkImg.width;
							watermarkScale = Math.min(MAX_WATERMARK_SCALE, Math.max(MIN_WATERMARK_SCALE, watermarkScale));
						}
						scaledWidth = watermarkImg.width * watermarkScale;
						scaledHeight = watermarkImg.height * watermarkScale;
					}

					const targetX = getDefaultWatermarkX(
						selectedWatermark,
						img.width,
						cropX,
						cropWidth,
						scaledWidth
					);
					const targetY = getDefaultWatermarkY(
						selectedWatermark,
						cropY,
						cropHeight,
						img.height,
						scaledHeight
					);
					const halfWidth = scaledWidth / 2;
					const halfHeight = scaledHeight / 2;

					watermarkX = Math.max(halfWidth, Math.min(img.width - halfWidth, targetX));
					watermarkY = Math.max(halfHeight, Math.min(img.height - halfHeight, targetY));

					if (watermarkImg) {
						drawCanvas();
					}
				};
				img.src = e.target?.result as string;
			};
			reader.readAsDataURL(file);
		}
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

	async function loadWatermark() {
		const watermark = selectedWatermark;
		if (!watermark) return;

		if (watermark.type === 'text') {
			const img = await createTextWatermarkImage(watermark);
			watermarkImg = img;
		} else {
			await new Promise<void>((resolve) => {
				const img = new Image();
				img.onload = () => {
					watermarkImg = img;
					resolve();
				};
				img.src = `${base}/${watermark.file}`;
			});
		}

		if (uploadedImage && watermarkImg) {
			const { cropWidth, cropHeight, cropX, cropY } = getExportCropFrame(uploadedImage);
			// Apply a consistent default scale for all watermarks
			const isOpinion = watermark.type !== 'text' && watermark.file.includes('opinion_bandeau');
			const isParlonsSolution = isParlons(watermark);
			const defaultScale = isOpinion
				? uploadedImage.width / watermarkImg.width
				: isParlonsSolution
					? 0.2
				: watermark.type === 'text'
					? TEXT_DEFAULT_WATERMARK_SCALE
					: IMAGE_DEFAULT_WATERMARK_SCALE;
			watermarkScale = isOpinion
				? defaultScale
				: Math.min(MAX_WATERMARK_SCALE, Math.max(MIN_WATERMARK_SCALE, defaultScale));

			const scaledWidth = watermarkImg.width * watermarkScale;
			const scaledHeight = watermarkImg.height * watermarkScale;
			const halfWidth = scaledWidth / 2;
			const halfHeight = scaledHeight / 2;

			const targetX = getDefaultWatermarkX(watermark, uploadedImage.width, cropX, cropWidth, scaledWidth);
			const targetY = getDefaultWatermarkY(
				watermark,
				cropY,
				cropHeight,
				uploadedImage.height,
				scaledHeight
			);

			watermarkX = Math.max(halfWidth, Math.min(uploadedImage.width - halfWidth, targetX));
			watermarkY = Math.max(halfHeight, Math.min(uploadedImage.height - halfHeight, targetY));
		}

		drawCanvas();
	}

	function drawCanvas() {
		if (!canvas || !ctx || !uploadedImage) return;

		canvas.width = uploadedImage.width;
		canvas.height = uploadedImage.height;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(uploadedImage, 0, 0);

		const watermarkRect = getWatermarkRect();
		if (watermarkImg && watermarkRect) {
			const watermarkOpacity = selectedWatermark.type === 'text' ? 1 : selectedWatermark.opacity ?? 1;
			ctx.save();
			ctx.globalAlpha = watermarkOpacity;
			ctx.drawImage(
				watermarkImg,
				watermarkRect.left,
				watermarkRect.top,
				watermarkRect.width,
				watermarkRect.height
			);
			ctx.restore();

		}

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

	function isPointOverWatermark(mouseX: number, mouseY: number): boolean {
		const watermarkRect = getWatermarkRect();
		if (!watermarkRect) return false;

		return mouseX >= watermarkRect.left &&
			mouseX <= watermarkRect.right &&
			mouseY >= watermarkRect.top &&
			mouseY <= watermarkRect.bottom;
	}

	function handlePointerDown(event: PointerEvent) {
		if (!canvas || !uploadedImage) return;

		activePointerId = event.pointerId;
		canvas.setPointerCapture(event.pointerId);

		const mouse = getPointerInImage(event);
		if (!mouse) return;

		isDragging = true;
		isDraggingWatermark = isPointOverWatermark(mouse.x, mouse.y);

		if (isDraggingWatermark) {
			// Moving watermark
			dragStartX = mouse.x - watermarkX;
			dragStartY = mouse.y - watermarkY;
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
		isHoveringWatermark = mouse ? isPointOverWatermark(mouse.x, mouse.y) : false;
		if (!isDragging || !mouse) return;

		if (isDraggingWatermark) {
			// Moving watermark with boundary constraints
			if (watermarkImg) {
				const scaledWidth = watermarkImg.width * watermarkScale;
				const scaledHeight = watermarkImg.height * watermarkScale;
				const halfWidth = scaledWidth / 2;
				const halfHeight = scaledHeight / 2;

				// Calculate new position
				const newX = mouse.x - dragStartX;
				const newY = mouse.y - dragStartY;

				// Clamp to image boundaries
				watermarkX = Math.max(halfWidth, Math.min(uploadedImage.width - halfWidth, newX));
				watermarkY = Math.max(halfHeight, Math.min(uploadedImage.height - halfHeight, newY));
			}
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
		canvas.releasePointerCapture(event.pointerId);
	}

	function downloadImage() {
		if (!uploadedImage || !watermarkImg) return;

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

		// Calculate watermark position relative to crop
		const watermarkRelX = watermarkX - cropX;
		const watermarkRelY = watermarkY - cropY;

		// Scale watermark position to export dimensions
		const scaleFactorX = exportCrop.width / cropWidth;
		const scaleFactorY = exportCrop.height / cropHeight;
		const exportWatermarkX = watermarkRelX * scaleFactorX;
		const exportWatermarkY = watermarkRelY * scaleFactorY;

		// Scale watermark size
		const exportWatermarkWidth = watermarkImg.width * watermarkScale * scaleFactorX;
		const exportWatermarkHeight = watermarkImg.height * watermarkScale * scaleFactorY;

		// Draw watermark
		const exportWatermarkOpacity = selectedWatermark.type === 'text' ? 1 : selectedWatermark.opacity ?? 1;
		exportCtx.save();
		exportCtx.globalAlpha = exportWatermarkOpacity;
		exportCtx.drawImage(
			watermarkImg,
			exportWatermarkX - exportWatermarkWidth / 2,
			exportWatermarkY - exportWatermarkHeight / 2,
			exportWatermarkWidth,
			exportWatermarkHeight
		);
		exportCtx.restore();

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
		if (uploadedImage && watermarkImg && canvas && ctx) {
			drawCanvas();
		}
	});

	onMount(() => {
		loadWatermark();
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
							<h3>Choisissez un style</h3>
						</div>
						<span class="hint">Cliquez pour appliquer</span>
					</div>
					<div class="watermark-grid">
						{#each watermarks as watermark}
							<button
								class="watermark-preview"
								class:active={selectedWatermark === watermark}
								onclick={() => {
									selectedWatermark = watermark;
									loadWatermark();
								}}
								onkeypress={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										selectedWatermark = watermark;
										loadWatermark();
									}
								}}
							>
								{#if watermark.type === 'text'}
									<span class="watermark-text-preview">{watermark.text}</span>
								{:else}
									<img src="{base}/{watermark.file}" alt={watermark.name} />
								{/if}
								<span class="watermark-name">{watermark.name}</span>
							</button>
						{/each}
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

				<div class="card">
					<div class="card-header">
						<div>
							<p class="eyebrow">Taille</p>
							<h3>Augementez ou diminuez la taille du filigrane</h3>
						</div>
						<span class="hint">Glissez pour affiner</span>
					</div>
					<div class="slider-row">
						<input
							type="range"
							min={MIN_WATERMARK_SCALE}
							max={MAX_WATERMARK_SCALE}
							step="0.05"
							bind:value={watermarkScale}
							oninput={() => drawCanvas()}
						/>
						<span class="slider-value">{watermarkScale.toFixed(2)}x</span>
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
						<h3></h3>
					</div>
					<div class="pill">Bougez le logo avec votre souris. Si le logo n'est pas dans le cadre rouge, il sera coupé</div>
				</div>
				<canvas
					bind:this={canvas}
					onpointerdown={handlePointerDown}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointercancel={handlePointerUp}
					onpointerleave={handlePointerUp}
					class:grab-cursor={isHoveringWatermark}
					class:move-cursor={!isHoveringWatermark}
				></canvas>
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
		cursor: pointer;
		transition: all 0.2s ease;
		width: 100%;
		box-sizing: border-box;
		min-height: 110px;
		position: relative;
	}

	.watermark-preview:hover {
		border-color: #6366f1;
		background: #f5f5ff;
		transform: translateY(-1px);
		box-shadow: 0 3px 10px rgba(99, 102, 241, 0.15);
	}

	.watermark-preview.active {
		border-color: #ef4444;
		background: #fef2f2;
		box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.35), 0 6px 14px rgba(239, 68, 68, 0.25);
		outline: 2px solid #ef4444;
	}

	.watermark-preview.active img,
	.watermark-preview.active .watermark-text-preview {
		border-color: #ef4444;
	}

	.watermark-preview.active:hover {
		border-color: #ef4444;
		background: #fee2e2;
	}

	.watermark-preview.active::after {
		content: 'Sélectionné';
		position: absolute;
		top: 6px;
		right: 8px;
		background: #ef4444;
		color: white;
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
		font-size: 0.65rem;
		font-weight: 700;
	}

	.watermark-preview img {
		width: auto;
		max-width: 100%;
		max-height: 80px;
		object-fit: contain;
		background: #fff;
		padding: 0.35rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		box-sizing: border-box;
	}

	.watermark-text-preview {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: auto;
		max-width: 100%;
		min-height: 80px;
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

	.watermark-preview.active .watermark-name {
		color: #4f46e5;
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

	.slider-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.slider-row input[type="range"] {
		width: 100%;
		height: 8px;
		border-radius: 4px;
		background: #e5e7eb;
		outline: none;
		cursor: pointer;
	}

	.slider-row input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #4f46e5;
		cursor: pointer;
		box-shadow: 0 3px 8px rgba(79, 70, 229, 0.35);
	}

	.slider-row input[type="range"]::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #4f46e5;
		cursor: pointer;
		border: none;
		box-shadow: 0 3px 8px rgba(79, 70, 229, 0.35);
	}

	.slider-value {
		font-weight: 700;
		color: #111827;
		min-width: 52px;
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

	.pill {
		background: #eef2ff;
		color: #4f46e5;
		border-radius: 999px;
		padding: 0.35rem 0.65rem;
		font-weight: 700;
		font-size: 0.8rem;
		border: 1px solid #e0e7ff;
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

	canvas.grab-cursor {
		cursor: grab;
	}

	canvas.grab-cursor:active {
		cursor: grabbing;
	}

	canvas.move-cursor {
		cursor: move;
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
