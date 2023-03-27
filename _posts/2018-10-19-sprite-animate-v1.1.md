---
layout: post
enable: true
postType: playground
title:  Sprite Animate v1.1
description: Sprite animation test
date:   2018-10-19 00:00:00 +0000
image:  '/resources/post/2018-10-19-sprite-animate-v1.1/img/thumnail.png'
projectIdx: 0
version: '1.1'
isLatest: true
tags:   [graphic engine, sprite, v1.1]
resourceUrl: '/resources/post/2018-10-19-sprite-animate-v1.1/'
---
<canvas id="gameScreen" width="640px" height="400px" tabindex="1" style="width: 100%;"></canvas>
---
#### Instructions
sprite animation test
- FPS: 30

#### Update
- Cheanged sprites image
- Support multi row sprites image
- Update graphic library

#### Credits
Development: HWANYONG YOO (UHD)
- Game engine: Graphic (v1.0.181019 Self Made)
- Published: Oct 19, 2018
- Sources:
	- Spriters Resource: Hwanyong Yoo(self made)
	- [Kenney Emotes Pack](https://www.kenney.nl/assets/emotes-pack)

#### Source
You can see the source code in Inspector > Sources > [sprite.js](/resources/post/2018-10-19-sprite-animate-v1.1/js/sprites.js)
###### sprite.js
{% highlight js %}
'use strict';
import Graphic from '../../../../Engine/1.0.181019/Graphic.js';
import GameObject from '../../../../Engine/1.0.181019/GameObject.js';

var BuilderIdle = new GameObject({
	name: 'Builder-idle',
	position: { x: 210, y: 143},
	width: 192,
	height: 192,
	resource: {
		type: 'sprite',
		path: '/playground/public/Resources/Images/Builder-idle-v2-64px-8x2.png'
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
		path: '/playground/public/Resources/Images/kenney-emotes-pack.png'
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
{% endhighlight %}

<script type="module" src="{{page.resourceUrl}}/js/sprites.js"></script>