class Money {
	name = null
	date = null // datejs object
	#amount = 0
	type = null // [ 'dept | balanse | income | expense | transfer | transfer-dept | transfer-balanse | transfer-income | transfer-expense' ]
	symbol = +1 // [ -1 | 1 ]

	symbolTypes = {
		'balanse'         : 1,
		'income'          : 1,
		'transfer'        : 1,
		'transfer-balanse': 1,
		'transfer-income' : 1,
		'dept'            : -1,
		'expense'         : -1,
		'transfer-dept'   : -1,
		'transfer-expense': -1,
	}

	constructor(name, date, amount, type, symbol) {
		this.name   = name
		this.date   = date
		this.#amount = amount
		this.type   = type
		this.symbol = this.symbolTypes[type]
	}

	get value() {
		return this.#amount * this.symbol
	}
	// set value(amount) {
	// 	this.#amount = amount * this.symbol
	// }
}

export { Money }