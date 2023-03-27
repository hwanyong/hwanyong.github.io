---
layout: post
enable: true
title:  Sprite Animate v1.0
description: Sprite animation test
date:   2018-09-20 00:00:00 +0000
image:  '/resources/post/2018-09-20-sprite-animate-v1.0/img/thumnail.png'
projectIdx: 0
version: '1.0'
isLatest: false
tags:   [graphic engine, sprite, v1.0]
resourceUrl: '/resources/post/2018-09-20-sprite-animate-v1.0'
---
<canvas id="gameScreen" width="640px" height="400px" tabindex="1" style="width: 100%;"></canvas>
---
#### Instructions
sprite animation test
- FPS: 30

#### Credits
Development: HWANYONG YOO (UHD)
- Game engine: (none)
- Published: Sep 20, 2018
- Sources:
	- [Spriters Resource](https://www.spriters-resource.com/)
	- [Kenney Emotes Pack](https://www.kenney.nl/assets/emotes-pack)

#### Source
You can see the source code in Inspector > Sources > [sprite.js]({{page.resourceUrl}}/js/sprites.js)
###### sprite.js
{% highlight js %}
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
		path: '/resources/post/2018-09-20-sprite-animate-v1.0/img/Pokemon - Bulbasaur_40by37.png'
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
		path: '/resources/post/2018-09-20-sprite-animate-v1.0/img/kenney-emotes-pack.png'
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
{% endhighlight %}

<script type="module" src="{{page.resourceUrl}}/js/sprites.js"></script>