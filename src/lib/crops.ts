export interface CropRatio {
	name: string;
	width: number;
	height: number;
	color: string;
	isExportCrop?: boolean; // If true, this crop is used for final export
}

export const cropRatios: CropRatio[] = [
	{ name: '16:9', width: 1920, height: 1080, color: '#ff6b6b', isExportCrop: true },
	{ name: '1:1', width: 1080, height: 1080, color: '#38b2ac' },
	{ name: '9:16', width: 1080, height: 1920, color: '#f6ad55' }
];

// Helper to get the export crop
export const getExportCrop = () => cropRatios.find(c => c.isExportCrop) || cropRatios[0];
