'use strict';
var Graphic = function (cvsID) {
	var FPS = 30;
	var RenderTimer;
	var RenderList = {};
	var Canvas = {};
	Canvas.main = null;
	Canvas.buffer = null;

	var graphic = this;
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
			RenderList[key].rendering(Canvas.buffer.context, RenderList[key]);
		}
	};
	graphic.StartRender = () => {
		RenderTimer = setInterval(graphic.ProcessingRender, 1000 / FPS);
	};
	graphic.ProcessingRender = () => {
		Canvas.buffer.context.fillStyle = '#000000';
		Canvas.buffer.context.fillRect(0, 0, Canvas.buffer.width, Canvas.buffer.height);
		
		graphic.RenderDelegate();
		Canvas.main.context.drawImage(Canvas.buffer, 0, 0);
	};
	graphic.StopRender = () => {
		clearInterval(RenderTimer);
	};

	graphic.addRenderList = (gameObject) => {
		RenderList[gameObject.options('name')] = gameObject;
	};

	graphic.Init(cvsID);

	return graphic;
};

var graphic = new Graphic('gameScreen');
graphic.StartRender();

export default graphic;