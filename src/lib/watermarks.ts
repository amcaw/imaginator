export interface Watermark {
	name: string;
	file: string;
}

export const watermarks: Watermark[] = [
	{ name: 'Blanc', file: 'faky_blanc.png' },
	{ name: 'Noir', file: 'faky_noir.png' },
	{ name: 'Decrypte', file: 'decrypte.png' },
	{ name: 'Live gauche', file: 'live_gauche.png' },
	{ name: 'Live milieu', file: 'live_centre.png' },
	{ name: 'Live droite', file: 'live_droite.png' },
];
