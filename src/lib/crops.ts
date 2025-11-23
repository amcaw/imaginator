export interface CropRatio {
	name: string;
	width: number;
	height: number;
	color: string;
	isExportCrop?: boolean; // If true, this crop is used for final export
}

export const cropRatios: CropRatio[] = [
	{ name: '1920 × 1080 (Export)', width: 1920, height: 1080, color: '#ff0000', isExportCrop: true },
	{ name: '400 × 400 (Guide)', width: 400, height: 400, color: '#00ff00' },
	{ name: '400 × 620 (Guide)', width: 400, height: 620, color: '#0000ff' }
];

// Helper to get the export crop
export const getExportCrop = () => cropRatios.find(c => c.isExportCrop) || cropRatios[0];
