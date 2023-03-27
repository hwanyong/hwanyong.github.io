'use strict';
import Graphic from '/resources/lib/Engine/1.0.180920/Graphic.js';
import GameObject from '/resources/lib/Engine/1.0.180920/GameObject.js';

var Bulbasaur = new GameObject({
	name: 'Bulbasaur',
	position: { x: 240, y: 174},
	width: 160,
	height: 148,
	resource: {
		type: 'sprite',
		path: '/resources/post/2018-10-19-sprite-animate-v1.0/img/Pokemon - Bulbasaur_40by37.png'
	},
	spriteOptions: {
		x: 1,
		y: 0,
		width: 40,
		height: 37,
		interval: 120,
		frame: 21,
		repeatMode: 'loop'
	}
});
var Emotes = new GameObject({
	name: 'Emotes',
	position: { x: 280, y: 130},
	width: 48,
	height: 57,
	resource: {
		type: 'sprite',
		path: '/resources/post/2018-10-19-sprite-animate-v1.0/img/kenney-emotes-pack.png'
	},
	spriteOptions: {
		x: 0,
		y: 0,
		width: 32,
		height: 38,
		interval: 1000,
		frame: 6,
		repeatMode: 'loop'
	}
});

Graphic.addRenderList(Emotes);
Graphic.addRenderList(Bulbasaur);