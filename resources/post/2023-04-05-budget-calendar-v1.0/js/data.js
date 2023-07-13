import { Money } from './classes.js'

const data = {
	'2023': {
		'4': {
			'1': [
				new Money('Salary', '2023-04-01', 10000, 'income'),
				new Money('Rent', '2023-04-01', 1000, 'expense'),
				new Money('Food', '2023-04-01', 1000, 'expense'),
				new Money('Transport', '2023-04-01', 1000, 'expense'),
				new Money('Entertainment', '2023-04-01', 1000, 'expense'),
				new Money('Clothes', '2023-04-01', 1000, 'expense'),
				new Money('Health', '2023-04-01', 1000, 'expense'),
				new Money('Education', '2023-04-01', 1000, 'expense'),
				new Money('Savings', '2023-04-01', 1000, 'expense'),
				new Money('Debt', '2023-04-01', 1000, 'dept'),
			],
			'2': [
				new Money('Salary', '2023-04-02', 10000, 'income'),
				new Money('Rent', '2023-04-02', 1000, 'expense'),
				new Money('Food', '2023-04-02', 1000, 'expense'),
				new Money('Transport', '2023-04-02', 1000, 'expense'),
				new Money('Entertainment', '2023-04-02', 1000, 'expense'),
				new Money('Clothes', '2023-04-02', 1000, 'expense'),
				new Money('Health', '2023-04-02', 1000, 'expense'),
				new Money('Education', '2023-04-02', 1000, 'expense'),
				new Money('Savings', '2023-04-02', 1000, 'expense'),
				new Money('Debt', '2023-04-02', 1000, 'dept'),
			],
			'3': [
				new Money('Salary', '2023-04-03', 10000, 'income'),
				new Money('Rent', '2023-04-03', 1000, 'expense'),
				new Money('Food', '2023-04-03', 1000, 'expense'),
				new Money('Transport', '2023-04-03', 1000, 'expense'),
				new Money('Entertainment', '2023-04-03', 1000, 'expense'),
				new Money('Clothes', '2023-04-03', 1000, 'expense'),
				new Money('Health', '2023-04-03', 1000, 'expense'),
				new Money('Education', '2023-04-03', 1000, 'expense'),
				new Money('Savings', '2023-04-03', 1000, 'expense'),
				new Money('Debt', '2023-04-03', 1000, 'dept'),
			]
		}
	}
}

const repeat = {
	'first': [
		new Money('House Rent', '1900-01-01', 2_000, 'transfer-expense')
	],
	'14': [
		new Money('Phone', '1900-01-01', 64, 'transfer-expense')
	]
}

export { data, repeat }