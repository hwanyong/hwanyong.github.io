class UHDCHART extends HTMLElement {
	constructor() {
		super()

		// progress
		// pie
		// bar
		// line
		// radar
		// polarArea
		// doughnut
		// bubble
		// scatter
		// area
		// step
		// horizontalBar
		// stackedBar
		// stackedArea
		// stackedStep
		// stackedHorizontalBar
		// stackedLine
		// stackedRadar
		// stackedPolarArea
		// stackedDoughnut
		// stackedBubble
		// stackedScatter
	}

	init = () => {
		this.attachShadow({ mode: 'open' })

		//#region not supported in Safari : Feb 18, 2023
		// const sheet = new CSSStyleSheet()
		// style.replaceSync(`:host { display: block; width: 100%; height: 100%; }`)
		// this.shadowRoot.adoptedStyleSheets = [style]
		//#endregion not supported in Safari : Feb 18, 2023

		const style = document.createElement('style')
		style.innerHTML = `
			:host {
				// --chart-value: attr(data-chart-value);
			}
			:host .value {
				// width: var(--chart-value, 0%);
				width: attr(data-chart-value);
				height: 100%;
				background-color: #f00;
			}
		`
		this.shadowRoot.appendChild(style)

		this.initDom(this)
	}
}

class PROGRESS extends UHDCHART {
	constructor(target, value, params = {}) {
		super()

		this.init()
	}

	initDom = (target) => {
		//target.shadowRoot.innerHTML = `
		//	<style>
		//		:host {
		//			display: block;
		//			width: 100%;
		//			height: 100%;
		//		}
		//		:host > div {
		//			width: 100%;
		//			height: 100%;
		//			background-color: #f0f0f0;
		//		}
		//		:host > div > div {
		//			width: 0;
		//			height: 100%;
		//			background-color: #0000ff;
		//		}
		//	</style>
		//	<div>
		//		<div></div>
		//	</div>
		//`

		const title = document.createElement('label')
		title.innerText = 'Hello World'
		target.shadowRoot.appendChild(title)

		const container = document.createElement('div')
		container.style.width = '100%'
		container.style.height = '30px'
		container.style.backgroundColor = '#f0f0f0'

		const value = document.createElement('div')
		value.dataset.chartValue = '10%'
		value.classList.add('value')
		value.style.width = 'attr(data-chart-value)'

		container.appendChild(value)

		target.shadowRoot.appendChild(container)
	}
}

export { UHDCHART, PROGRESS }