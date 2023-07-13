import { Money } from './classes.js'
import { data, repeat } from './data.js'

console.log(data, repeat)

Object.entries(data).forEach(([year, months]) => {
	Object.entries(months).forEach(([month, days]) => {
		Object.entries(days).forEach(([day, money]) => {
			console.log(year, month, day, money)
		})
	})
})