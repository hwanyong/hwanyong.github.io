'use strict';
import Graphic from '/resources/lib/Engine/1.0.181019/Graphic.js';
import GameObject from '/resources/lib/Engine/1.0.181019/GameObject.js';

var BuilderIdle = new GameObject({
	name: 'Builder-idle',
	position: { x: 210, y: 143},
	width: 192,
	height: 192,
	resource: {
		type: 'sprite',
		path: '/resources/post/2018-10-19-sprite-animate-v1.1/img/Builder-idle-v2-64px-8x2.png'
	},
	spriteOptions: {
		x: 0,
		y: 0,
		width: 64,
		height: 64,
		interval: 80,
		frame: {
			length: 16,
			row: 2,
			col: 8
		},
		repeatMode: 'loop'
	}
}).setRender((ctx, self, opts) => {
	ctx.drawImage(
		opts.resource.img,
		opts.animate.target.x,
		opts.animate.target.y,
		opts.spriteOptions.width,
		opts.spriteOptions.height,
		opts.position.x,
		opts.position.y,
		opts.width,
		opts.height);
});
var Emotes = new GameObject({
	name: 'Emotes',
	position: { x: 270, y: 100},
	width: 64,
	height: 74,
	resource: {
		type: 'sprite',
		path: '/resources/post/2018-10-19-sprite-animate-v1.1/img/kenney-emotes-pack.png'
	},
	spriteOptions: {
		x: 0,
		y: 0,
		width: 32,
		height: 38,
		interval: 1000,
		frame: {
			length: 6,
			row: 1,
			col: 6
		},
		repeatMode: 'loop'
	}
}).setRender((ctx, self, opts) => {
	ctx.drawImage(
		opts.resource.img,
		opts.animate.target.x,
		opts.animate.target.y,
		opts.spriteOptions.width,
		opts.spriteOptions.height,
		opts.position.x,
		opts.position.y,
		opts.width,
		opts.height);
});

Graphic.SetBackgroundColor('#ffffff');
BuilderIdle.startSprite();
Emotes.startSprite();
Graphic.addRenderList(BuilderIdle);
Graphic.addRenderList(Emotes);