'use strict';
export default function GameObject (obj, render) {
	var self = this;
	var name; // unique value;
	var position = {
		x: 0,
		y: 0
	};
	var width = 0;
	var height = 0;
	var resource = {
		type: 'shape', // ['sprite', 'image', 'shape' ...]
		path: ''
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

	self.data = {};
	self.init = (obj, render) => {
		name = obj.name;
		width = obj.width || width;
		height = obj.height || height;

		if (typeof obj.position !== 'undefined') {
			position.x = obj.position.x || position.x;
			position.y = obj.position.y || position.y;
		}
		
		if (typeof obj.resource !== 'undefined') {
			resource.type = obj.resource.type || resource.type;
			resource.path = obj.resource.path || resource.path;
		}

		if (typeof obj.spriteOptions !== 'undefined') {
			spriteOptions.x = obj.spriteOptions.x || spriteOptions.x;
			spriteOptions.y = obj.spriteOptions.y || spriteOptions.y;
			spriteOptions.width = obj.spriteOptions.width || spriteOptions.width;
			spriteOptions.height = obj.spriteOptions.height || spriteOptions.height;
			spriteOptions.interval = obj.spriteOptions.interval || spriteOptions.interval;
			spriteOptions.frame = obj.spriteOptions.frame || spriteOptions.frame;
			spriteOptions.repeatMode = obj.spriteOptions.repeatMode || spriteOptions.repeatMode;
		}

		if (typeof obj.data !== 'undefined') {
			self.data = obj.data;
		}

		switch(resource.type) {
			case 'sprite':
			case 'image':
				resource.img = new Image();
				resource.img.src = resource.path;
				break;
		}

		if (typeof render !== 'undefined') {
			self.rendering = render;
		}
		return self.setRender;
	};
	self.options = (_name, _value) => {
		if (_name === void 0) { return; }
		if (_value === void 0 && typeof _name === 'string') {
			switch (_name) {
				case 'name': return name;
				case 'position': return position;
				case 'width': return width;
				case 'height': return height;
				case 'resource': return resource;
				case 'animate': return animate;
				case 'spriteOptions': return spriteOptions;
			}
		}

		switch (_name) {
			case 'name': name = _value; break;
			case 'position': position = _value; break;
			case 'width': width = _value; break;
			case 'height': height = _value; break;
			case 'resource': resource = _value; break;
			case 'animate': animate = _value; break;
			case 'spriteOptions': spriteOptions = _value; break;
		}
	};

	self.setRender = (render) => {
		if (typeof render === 'undefined') {
			self.rendering = () => {};
		}
		else { self.rendering = render; }

		return self;
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

	self.init(obj, render);

	return self;
}