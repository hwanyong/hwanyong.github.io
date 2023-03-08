class UHDChartCore {
	target = null

	constructor(target) {
		this.target = target
	}

	init = target => {
		target.attachShadow({ mode: 'open' })

		//#region not supported in Safari : Feb 18, 2023
		// const sheet = new CSSStyleSheet()
		// style.replaceSync(`:host { display: block; width: 100%; height: 100%; }`)
		// this.shadowRoot.adoptedStyleSheets = [style]
		//#endregion not supported in Safari : Feb 18, 2023

		const style = document.createElement('style')
		style.innerHTML = `
			.value {
				width: var(--chart-value, 0);
				height: 100%;
				background-color: #f00;
				transition:
					width 0.5s ease,
					background-color 0.5s ease;
			}
		`
		target.shadowRoot.appendChild(style)

		this.#definePropertiesForTriggers(target)
		this.#bindEvents(target)
		this.#setStyles(target)
		this.initDom(target)
	}
	#setStyles = target => {
		//!TypeError: undefined is not an object (evaluating 'console.trace(target['value']) at UHDChartCore.#setStyles')
		//TODO: Why is this not working?
		// ['value'].forEach(key => {})

		for(const key of ['value']) {
			target.style.setProperty(`--chart-${key}`, target[key])
		}
	}
	#trigger_Change = target => {
		target.dispatchEvent(new Event('change', {
			bubbles: true,
			cancelable: true
		}))
	}

	#definePropertiesForTriggers = target => {
		Object.defineProperty(target, 'value', {
			get: () => target.getAttribute('value'),
			set: (value = '0%') => {
				//TODO: check value is valid (format: percentage:string. default: 0%)
				target.setAttribute('value', value)
				this.#trigger_Change(target)
			}
		})

		Object.defineProperty(target, 'type', {
			get: () => target.getAttribute('type'),
			set: value => {
				//TODO: check value is valid (format: string)
				target.setAttribute('type', value)
			}
		})

		let idx = 0
		while(true) {
			const stepValue = target.getAttribute(`step-value-${idx}`)
			const stepColor = target.getAttribute(`step-color-${idx}`)

			if (!stepValue || !stepColor) break

			Object.defineProperty(target, `stepValue-${idx}`, {
				set: value => this.#trigger_Change(target)
			})
			Object.defineProperty(target, `stepColor-${idx}`, {
				set: value => this.#trigger_Change(target)
			})

			idx += 1
		}
	}
	#bindEvents = target => {
		target.addEventListener('change', e => {
			this.#setStyles(e.currentTarget)
		})
	}
}

class Progress extends UHDChartCore {
	constructor(target, value, params = {}) {
		super(target)

		this.init(this.target)
	}

	initDom = target => {
		const value = document.createElement('div')
		value.part = 'value'
		value.classList.add('value')

		const container = document.createElement('div')
		container.part = 'container'
		container.style.width = '100%'
		container.style.height = '30px'
		container.style.backgroundColor = '#f0f0f0'
		container.appendChild(value)

		target.shadowRoot.appendChild(container)
	}
}

function UHDChart(target) {
	const types = {
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

	return eval(`new ${types[target.getAttribute('type')]}(target)`) //! variable 'target' used here
}

export { UHDChart, Progress }