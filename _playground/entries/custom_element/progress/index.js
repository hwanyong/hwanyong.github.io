console.trace('entries/chart/progress/index.js')

import hljs from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/es/highlight.min.js';
import { UHDCHART } from '../uhd-chart.js'

hljs.highlightAll()

customElements.define('uhd-chart', UHDCHART, { extends: 'div' })

console.trace(UHDCHART)