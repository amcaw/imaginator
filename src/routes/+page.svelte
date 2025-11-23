<script lang="ts">
	import { onMount } from 'svelte';
	import { watermarks } from '$lib/watermarks';
	import { cropRatios, getExportCrop } from '$lib/crops';

	let uploadedImage = $state<HTMLImageElement | null>(null);
	let selectedWatermark = $state<string>(watermarks[0].file);
	let watermarkImg = $state<HTMLImageElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let ctx = $state<CanvasRenderingContext2D | null>(null);

	let watermarkX = $state(50);
	let watermarkY = $state(50);
	let watermarkScale = $state(0.35);
	let isDragging = $state(false);
	let dragStartX = $state(0);
	let dragStartY = $state(0);

	// Track which crop overlays are visible - 16:9 selected by default
	let visibleCrops = $state<Set<number>>(new Set([0]));

	// Crop repositioning
	let cropOffsetX = $state(0);
	let cropOffsetY = $state(0);
	let isDraggingWatermark = $state(false);
	let isHoveringWatermark = $state(false);
	let isDraggingFile = $state(false);

	function loadImageFromFile(file: File) {
		if (file && file.type.startsWith('image/')) {
			const reader = new FileReader();
			reader.onload = (e) => {
				const img = new Image();
				img.onload = () => {
					uploadedImage = img;

					// Calculate 16:9 frame position
					const exportCrop = getExportCrop();
					const cropAspectRatio = exportCrop.width / exportCrop.height;
					const imageAspectRatio = img.width / img.height;

					let cropWidth, cropHeight;
					if (cropAspectRatio > imageAspectRatio) {
						cropWidth = img.width;
						cropHeight = img.width / cropAspectRatio;
					} else {
						cropHeight = img.height;
						cropWidth = img.height * cropAspectRatio;
					}

					const cropX = (img.width - cropWidth) / 2;
					const cropY = (img.height - cropHeight) / 2;

					// Position watermark in upper right corner of 16:9 frame
					// Using percentages of crop dimensions for consistency
					const paddingXPercent = 0.25; // 25% from right edge
					const paddingYPercent = 0.12; // 12% from top edge
					watermarkX = cropX + cropWidth - (cropWidth * paddingXPercent);
					watermarkY = cropY + (cropHeight * paddingYPercent);

					// Scale watermark relative to crop frame width for consistency
					// This ensures watermark appears same size regardless of source image resolution
					if (watermarkImg) {
						const targetWatermarkWidthPercent = 0.20; // Watermark should be 20% of frame width
						watermarkScale = (cropWidth * targetWatermarkWidthPercent) / watermarkImg.width;
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

	function loadWatermark() {
		return new Promise<void>((resolve) => {
			const img = new Image();
			img.onload = () => {
				watermarkImg = img;
				resolve();
			};
			img.src = `/${selectedWatermark}`;
		});
	}

	function drawCanvas() {
		if (!canvas || !ctx || !uploadedImage) return;

		canvas.width = uploadedImage.width;
		canvas.height = uploadedImage.height;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(uploadedImage, 0, 0);

		if (watermarkImg) {
			const scaledWidth = watermarkImg.width * watermarkScale;
			const scaledHeight = watermarkImg.height * watermarkScale;

			ctx.drawImage(
				watermarkImg,
				watermarkX - scaledWidth / 2,
				watermarkY - scaledHeight / 2,
				scaledWidth,
				scaledHeight
			);
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

	function isMouseOverWatermark(mouseX: number, mouseY: number): boolean {
		if (!watermarkImg) return false;

		const scaledWidth = watermarkImg.width * watermarkScale;
		const scaledHeight = watermarkImg.height * watermarkScale;

		const watermarkLeft = watermarkX - scaledWidth / 2;
		const watermarkTop = watermarkY - scaledHeight / 2;
		const watermarkRight = watermarkLeft + scaledWidth;
		const watermarkBottom = watermarkTop + scaledHeight;

		return mouseX >= watermarkLeft && mouseX <= watermarkRight &&
		       mouseY >= watermarkTop && mouseY <= watermarkBottom;
	}

	function handleCanvasMouseMove(event: MouseEvent) {
		if (!canvas || !uploadedImage) return;

		const rect = canvas.getBoundingClientRect();
		const scaleX = uploadedImage.width / rect.width;
		const scaleY = uploadedImage.height / rect.height;

		const mouseX = (event.clientX - rect.left) * scaleX;
		const mouseY = (event.clientY - rect.top) * scaleY;

		isHoveringWatermark = isMouseOverWatermark(mouseX, mouseY);
	}

	function handleMouseDown(event: MouseEvent) {
		if (!canvas || !uploadedImage) return;

		const rect = canvas.getBoundingClientRect();
		const scaleX = uploadedImage.width / rect.width;
		const scaleY = uploadedImage.height / rect.height;

		const mouseX = (event.clientX - rect.left) * scaleX;
		const mouseY = (event.clientY - rect.top) * scaleY;

		isDragging = true;
		isDraggingWatermark = isMouseOverWatermark(mouseX, mouseY);

		if (isDraggingWatermark) {
			// Moving watermark
			dragStartX = mouseX - watermarkX;
			dragStartY = mouseY - watermarkY;
		} else {
			// Moving crop frame
			dragStartX = mouseX - cropOffsetX;
			dragStartY = mouseY - cropOffsetY;
		}
	}

	function handleMouseMove(event: MouseEvent) {
		if (!isDragging || !canvas || !uploadedImage) return;

		const rect = canvas.getBoundingClientRect();
		const scaleX = uploadedImage.width / rect.width;
		const scaleY = uploadedImage.height / rect.height;

		const mouseX = (event.clientX - rect.left) * scaleX;
		const mouseY = (event.clientY - rect.top) * scaleY;

		if (isDraggingWatermark) {
			// Moving watermark with boundary constraints
			if (watermarkImg) {
				const scaledWidth = watermarkImg.width * watermarkScale;
				const scaledHeight = watermarkImg.height * watermarkScale;
				const halfWidth = scaledWidth / 2;
				const halfHeight = scaledHeight / 2;

				// Calculate new position
				const newX = mouseX - dragStartX;
				const newY = mouseY - dragStartY;

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
			const newOffsetX = mouseX - dragStartX;
			const newOffsetY = mouseY - dragStartY;

			cropOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX));
			cropOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY));
		}

		drawCanvas();
	}

	function handleMouseUp() {
		isDragging = false;
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
		exportCtx.drawImage(
			watermarkImg,
			exportWatermarkX - exportWatermarkWidth / 2,
			exportWatermarkY - exportWatermarkHeight / 2,
			exportWatermarkWidth,
			exportWatermarkHeight
		);

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

	$effect(() => {
		loadWatermark();
	});

	// Draw canvas whenever image or watermark changes
	$effect(() => {
		if (uploadedImage && watermarkImg && canvas && ctx) {
			drawCanvas();
		}
	});

	onMount(() => {
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	});
</script>

<div class="container">
	<h1>Ajoutez un filigrane à vos images</h1>

	{#if uploadedImage}
		<div class="controls">
			<div class="controls-grid">
				<div class="watermark-selection">
					<label>Filigrane :</label>
					<div class="watermark-options">
						{#each watermarks as watermark}
							<div
								class="watermark-preview"
								class:active={selectedWatermark === watermark.file}
								onclick={() => {
									selectedWatermark = watermark.file;
									loadWatermark();
								}}
								role="button"
								tabindex="0"
								onkeypress={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										selectedWatermark = watermark.file;
										loadWatermark();
									}
								}}
							>
								<img src="/{watermark.file}" alt={watermark.name} />
								<span class="watermark-name">{watermark.name}</span>
							</div>
						{/each}
					</div>
				</div>

				<div class="crop-selection">
					<label>Cadres :</label>
					<div class="crop-options">
						{#each cropRatios as crop, index}
							<label class="crop-checkbox">
								<input
									type="checkbox"
									checked={visibleCrops.has(index)}
									onchange={() => toggleCrop(index)}
								/>
								<span class="crop-label" style="border-color: {crop.color}; color: {crop.color}">
									{crop.name}
								</span>
							</label>
						{/each}
					</div>
				</div>

				<div class="scale-control">
					<label>Taille :</label>
					<input
						type="range"
						min="0.1"
						max="1"
						step="0.05"
						bind:value={watermarkScale}
						oninput={() => drawCanvas()}
					/>
				</div>

				<button class="download-btn" onclick={downloadImage}>
					Télécharger
				</button>
			</div>
		</div>
	{/if}

	{#if uploadedImage}
		<div class="canvas-container">
			<canvas
				bind:this={canvas}
				onmousedown={handleMouseDown}
				onmousemove={handleCanvasMouseMove}
				class:grab-cursor={isHoveringWatermark}
				class:move-cursor={!isHoveringWatermark}
			></canvas>
			<div class="instructions">
				<p class="instruction" class:active={isHoveringWatermark}>
					<span class="icon">✋</span> Sur le filigrane : glisser pour le déplacer
				</p>
				<p class="instruction" class:active={!isHoveringWatermark}>
					<span class="icon">↔️</span> Ailleurs : glisser pour repositionner le cadre 16:9
				</p>
			</div>
		</div>
	{:else}
		<div
			class="drop-zone"
			class:dragging={isDraggingFile}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
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
		background: #f8f9fa;
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

	h1 {
		color: #2d3748;
		text-align: center;
		font-size: 1.25rem;
		margin: 0;
		padding: 0.25rem 0;
		flex-shrink: 0;
		font-weight: 700;
	}

	.controls {
		background: white;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
		flex-shrink: 0;
		box-sizing: border-box;
	}

	.controls-grid {
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		gap: 1rem;
		align-items: center;
	}

	.watermark-selection {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.watermark-selection label {
		font-weight: 600;
		color: #333;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.watermark-options {
		display: flex;
		gap: 0.5rem;
	}

	.watermark-preview {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.4rem;
		border: 2px solid #e0e0e0;
		background: white;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.watermark-preview:hover {
		border-color: #667eea;
		background: #f9f9ff;
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
	}

	.watermark-preview.active {
		border-color: #667eea;
		background: #f0f2ff;
		box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
	}

	.watermark-preview img {
		width: 45px;
		height: 45px;
		object-fit: contain;
		background: #f5f5f5;
		padding: 0.2rem;
		border-radius: 4px;
	}

	.watermark-name {
		font-size: 0.7rem;
		font-weight: 600;
		color: #666;
		text-align: center;
	}

	.watermark-preview.active .watermark-name {
		color: #667eea;
	}

	.crop-selection {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.crop-selection > label {
		font-weight: 600;
		color: #333;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.crop-options {
		display: flex;
		gap: 0.5rem;
	}

	.crop-checkbox {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		cursor: pointer;
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
		background: white;
		border: 2px solid #e0e0e0;
		transition: all 0.2s ease;
	}

	.crop-checkbox:hover {
		background: #f9f9f9;
	}

	.crop-checkbox input[type="checkbox"] {
		cursor: pointer;
		width: 16px;
		height: 16px;
	}

	.crop-label {
		font-weight: 600;
		padding: 0.2rem 0.5rem;
		border-radius: 3px;
		border: 2px solid;
		background: white;
		transition: all 0.2s ease;
		font-size: 0.75rem;
	}

	.crop-checkbox input[type="checkbox"]:checked + .crop-label {
		background: currentColor;
		color: white !important;
	}

	.scale-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.scale-control label {
		font-weight: 600;
		color: #333;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.scale-control input[type="range"] {
		width: 150px;
		height: 6px;
		border-radius: 3px;
		background: #e0e0e0;
		outline: none;
		cursor: pointer;
	}

	.scale-control input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #667eea;
		cursor: pointer;
	}

	.scale-control input[type="range"]::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #667eea;
		cursor: pointer;
		border: none;
	}

	.download-btn {
		padding: 0.5rem 1rem;
		background: #2d3748;
		color: white;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85rem;
		transition: all 0.2s ease;
		white-space: nowrap;
	}

	.download-btn:hover {
		background: #1a202c;
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

	.instructions {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.35rem;
		background: #f5f5f5;
		border-radius: 6px;
		flex-shrink: 0;
	}

	.instruction {
		color: #999;
		font-size: 0.75rem;
		margin: 0;
		padding: 0.25rem 0.4rem;
		border-radius: 4px;
		transition: all 0.3s ease;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.instruction.active {
		color: #667eea;
		background: white;
		font-weight: 600;
		transform: scale(1.02);
		box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
	}

	.instruction .icon {
		font-size: 1.2rem;
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
