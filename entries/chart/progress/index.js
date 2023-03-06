import hljs from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/es/highlight.min.js';
import { UHDChart } from '../uhd-chart.js'

hljs.highlightAll()

const chart = UHDChart(document.querySelector('.uhd.chart'))