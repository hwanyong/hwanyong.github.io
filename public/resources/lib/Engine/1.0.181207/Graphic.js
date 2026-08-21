'use strict';
var Graphic = function (cvsID) {
	var FPS = 30;
	var RenderTimer;
	var RenderList = {};
	var bgColor = '#000000';
	var Canvas = {};
	Canvas.main = null;
	Canvas.buffer = null;

	// Private Functions
	var __Crash = err => {
		console.error(err);
		graphic.StopRender();
	}

	// Public Functions
	var graphic = this;
	graphic.SetBackgroundColor = _bgColor => bgColor = _bgColor;
	graphic.Init = (cvsID) => {
		Canvas.main = document.getElementById(cvsID);
		Canvas.main.context = Canvas.main.getContext('2d');
		Canvas.main.context.imageSmoothingEnabled = false;
		Canvas.buffer = document.createElement('canvas');
		Canvas.buffer.setAttribute('width', Canvas.main.width);
		Canvas.buffer.setAttribute('height', Canvas.main.height);
		Canvas.buffer.context = Canvas.buffer.getContext('2d');
		Canvas.buffer.context.imageSmoothingEnabled = false;
	};
	graphic.RenderDelegate = () => {
		for (var key in RenderList) {
			if (!RenderList[key].rendering) {
				__Crash({
					code: '001',
					message: 'Undefined "RENDERING" function in GameObject'
				});
				return;
			}
			RenderList[key].rendering(Canvas.buffer.context, RenderList[key]);
		}
	};
	graphic.StartRender = () => {
		RenderTimer = setInterval(graphic.ProcessingRender, 1000 / FPS);
	};
	graphic.ProcessingRender = () => {
		Canvas.buffer.context.fillStyle = bgColor;
		Canvas.buffer.context.fillRect(0, 0, Canvas.buffer.width, Canvas.buffer.height);
		
		graphic.RenderDelegate();
		Canvas.main.context.drawImage(Canvas.buffer, 0, 0);
	};
	graphic.StopRender = () => {
		clearInterval(RenderTimer);
	};

	graphic.addRenderList = gameObject => {
		RenderList[gameObject.options('name')] = gameObject;
	};

	graphic.Init(cvsID);

	return graphic;
};

var graphic = new Graphic('gameScreen');
graphic.StartRender();

export default graphic;