'use strict';
export default function GameObject (obj) {
	var self = this;
	var name; // unique value;
	var position = {
		x: 0,
		y: 0
	};
	var width = 0;
	var height = 0;
	var resource = {
		type: 'image', // ['sprite', 'image']
		path: '',
		obj: null
	};
	var animate = {
		isPlay: false,
		target: {
			x: 0,
			y: 0,
			frame: 1
		}
	};
	var spriteOptions = {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		interval: 0,
		frame: 0,
		repeatMode: 'loop' // one, loop
	};

	self.init = (obj) => {
		name = obj.name;
		position = obj.position;
		width = obj.width;
		height = obj.height;
		resource = obj.resource;
		spriteOptions = obj.spriteOptions;

		switch(obj.resource.type) {
			case 'sprite':
			case 'image':
				resource.img = new Image();
				resource.img.src = resource.path;
				break;
		}
	};
	self.property = (_name, _value) => {
		if (_name === void 0) { return; }
		if (_value === void 0 && typeof _name === 'string') {
			switch (_name) {
				case 'name': return name;
				case 'position': return position;
				case 'width': return width;
				case 'height': return height;
			}
		}
	};
	self.rendering = (ctx) => {
		switch (resource.type) {
			case 'sprite':
				if (!animate.isPlay) { self.startSprite(); }

				ctx.drawImage(
					resource.img,
					animate.target.x,
					animate.target.y,
					spriteOptions.width,
					spriteOptions.height,
					position.x,
					position.y,
					width,
					height);
				break;
			case 'image':
				ctx.drawImage(
					resource.img,
					0,
					0,
					width,
					height);
				break;
		}
	};

	self.startSprite = () => {
		animate.isPlay = true;
		spriteOptions.timer = setInterval(() => {
			// next frame: one base
			if (animate.target.frame === spriteOptions.frame) {
				animate.target.frame = 1;
				animate.target.x = spriteOptions.x;
				animate.target.y = spriteOptions.y;
			}
			else {
				animate.target.frame += 1;
				animate.target.x = spriteOptions.x + (spriteOptions.width * (animate.target.frame - 1));
				animate.target.y = spriteOptions.y;
			}
		}, spriteOptions.interval);
	};
	self.stopSprite = () => {
		animate.isPlay = false;
		clearInterval(spriteOptions.timer);
	};

	self.init(obj);

	return self;
}