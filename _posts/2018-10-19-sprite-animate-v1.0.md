---
layout: post
title:  Sprite Animate v1.0
description: Sprite animation test
date:   2018-10-19 00:00:00 +0000
image:  '/images/post/2018-10-19-sprite-animate-v1.0/thumnail.png'
tags:   [graphic engine, sprite, v1.0]
---

<canvas id="gameScreen" width="640px" height="400px" tabindex="1"></canvas>
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

<script type="text/javascript">
console.log('test')
let App = {
	id: `labs-frame-sprite`,
	version: 1,
	gameID: `labs-frame-sprite-1`
};
document.addEventListener('DOMContentLoaded', () => {
	let ResourceItem = function (obj) {
		let self = this;
		self.path = obj.path;
		self.type = obj.type;

		return self;
	};
	let ReleaseItem = function (obj) {
		let self = this;
		self.id = obj.id;
		self.version = obj.version;
		self.thumbnail = obj.thumbnail;
		self.name = obj.name;
		self.extension = obj.extension;
	};
	let Detail = function () {
		let vm = this;
		vm.name = ko.observable('');
		vm.instructions = ko.observable('');
		vm.credits = ko.observable('');
		vm.video = {
			featured: ko.observable(''),
			more: ko.observable('')
		};
		vm.resources = {
			'javascript': ko.observableArray()
		};
		vm.previousReleaseItems = ko.observableArray();

		vm.showDetail = (data, event) => { window.location.href = `/playground/${data.id}.${data.type}`; };

		vm.init = () => {
			database.collection("/Programs")
			.where('id', '==', App.id)
			.where('version', '==', App.version)
			.get()
			.then(prog => {
				prog.forEach(info => {
					let data = info.data();
					vm.name(data.information.name);
					vm.instructions(data.information.instructions);
					vm.credits(data.information.credits);
					if (typeof data.information.videos !== 'undefined') {
						vm.video.featured(data.information.videos.featured);
						vm.video.more(data.information.videos.externalLink);
					}
					for (let key in data.resources) {
						data.resources[key].forEach((val, idx, arr) => {
							vm.resources.javascript.push(new ResourceItem(val));
						});
					}
				});
			});

			database.collection("/Programs")
			.where('id', '==', App.id)
			.where('isView', '==', true)
			//- .where('version', '>', App.version)
			//- .where('version', '<', App.version)
			.orderBy('version', 'desc')
			.get()
			.then(prog => {
				prog.forEach(info => {
					let data = info.data();
					vm.previousReleaseItems.push(new ReleaseItem({
						'id': data.id,
						'version': data.version,
						'thumbnail': data.information.thumbnail,
						'name': data.information.name,
						'extension': data.extension
					}));
				});
			});
		}

		vm.init();
		return vm;
	};

	let vmDetail = new Detail();
	ko.applyBindings(vmDetail);
});
</script>