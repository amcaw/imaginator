export type ImageWatermark = {
	name: string;
	file: string;
	opacity?: number;
	type?: 'image';
};

export type NoneWatermark = {
	name: string;
	type: 'none';
};

export type TextWatermark = {
	name: string;
	text: string;
	type: 'text';
	font?: string;
	fontWeight?: number;
	color?: string;
	outlineColor?: string;
	outlineWidth?: number;
	shadowColor?: string;
	shadowBlur?: number;
	padding?: number;
};

export type Watermark = ImageWatermark | TextWatermark | NoneWatermark;

export const watermarks: Watermark[] = [
	{ name: 'Aucun filigrane', type: 'none' },
	{
		name: 'Généré par IA',
		text: 'IMAGE GÉNÉRÉE PAR IA',
		type: 'text',
		font: 'Montserrat',
		fontWeight: 700,
		color: 'white',
		outlineColor: 'rgba(0, 0, 0, 0.6)',
		outlineWidth: 4,
		shadowColor: 'rgba(0, 0, 0, 0.35)',
		shadowBlur: 10,
		padding: 26
	},
	{ name: 'Blanc', file: 'faky_blanc.png' },
	{ name: 'Noir', file: 'faky_noir.png' },
	{ name: 'Decrypte', file: 'decrypte.png' },
	{ name: 'Live gauche', file: 'live_gauche.png' },
	{ name: 'Live milieu', file: 'live_centre.png' },
	{ name: 'Live droite', file: 'live_droite.png' },
	{ name: 'Opinion bandeau', file: 'opinion_bandeau.png', opacity: 1 },
	{ name: 'Enquête', file: 'enquete.png', opacity: 1 },
	{ name: 'Parlons solutions clair', file: 'Parlons_solutions_clair.png' },
	{ name: 'Parlons solutions sombre', file: 'Parlons_solutions_sombre.png' },
];
