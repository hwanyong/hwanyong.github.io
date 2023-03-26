console.trace('entries/chart/uhd-chart.js')

class UHDChartCore {
	target = null

	constructor(target) {
		this.target = target
	}

	init = (target) => {
		target.attachShadow({ mode: 'open' })

		//#region not supported in Safari : Feb 18, 2023
		// const sheet = new CSSStyleSheet()
		// style.replaceSync(`:host { display: block; width: 100%; height: 100%; }`)
		// this.shadowRoot.adoptedStyleSheets = [style]
		//#endregion not supported in Safari : Feb 18, 2023

		const style = document.createElement('style')
		style.innerHTML = `
			:host {
				--chart-value: attr(data-value);
			}
			:host .value {
				// width: var(--chart-value, 0%);
				width: attr(value);
				height: 100%;
				background-color: #f00;
			}
		`
		target.shadowRoot.appendChild(style)

		this.initDom(target)
	}

	get value() {
		return this.target.attributes.value.value
	}
	set value(value) {
		this.target.attributes.value.value = value
	}
}

class Progress extends UHDChartCore {
	constructor(target, value, params = {}) {
		super(target)

		this.init(this.target)
	}

	initDom = (target) => {
		const title = document.createElement('label')
		title.innerText = 'Hello World'

		const value = document.createElement('div')
		value.classList.add('value')

		const container = document.createElement('div')
		container.style.width = '100%'
		container.style.height = '30px'
		container.style.backgroundColor = '#f0f0f0'
		container.appendChild(value)

		target.shadowRoot.appendChild(title)
		target.shadowRoot.appendChild(container)
	}
}

class UHDCHART extends HTMLDivElement {
	#types = {
		progress            : 'Progress',
	// 	pie                 : null,
	// 	bar                 : null,
	// 	line                : null,
	// 	radar               : null,
	// 	polarArea           : null,
	// 	doughnut            : null,
	// 	bubble              : null,
	// 	scatter             : null,
	// 	area                : null,
	// 	step                : null,
	// 	horizontalBar       : null,
	// 	stackedBar          : null,
	// 	stackedArea         : null,
	// 	stackedStep         : null,
	// 	stackedHorizontalBar: null,
	// 	stackedLine         : null,
	// 	stackedRadar        : null,
	// 	stackedPolarArea    : null,
	// 	stackedDoughnut     : null,
	// 	stackedBubble       : null,
	// 	stackedScatter      : null,
	}

	#root = null
	#type = null

	constructor() {
		super()

		this.#type = this.attributes.type.value
		this.#root = eval(`new ${this.#types[this.#type]}(this)`)

		console.trace(this)
	}

	get value() {
		return this.#root.value
	}
	set value(value) {
		this.#root.value = value
	}
}

export { UHDCHART, Progress }