const fetch = require('node-fetch')
const cheerio = require('cheerio')
const Promise = require('bluebird')
const Table = require('cli-table')
const ProgressBar = require('progress')

const rates = require('./rates')

const opts = {
  departure: 1374,
  arrival: 1745,
  date: '22.09.2018',
  adults: 2,
  connection: 17
}

const rootUrl = 'https://www.flixbus.com/'
const searchUrl = `/search?departureCity=${opts.departure}&arrivalCity=${opts.arrival}&rideDate=${opts.date}&adult=${opts.adults}`
const compareCurrency = 'CZK'

const currencies = {
  'KM': 'BAM',
  'лв.': 'BGN',
  '€': 'EUR',
  'kr.': 'DKK',
  '£': 'GBP',
  '$': 'USD',
  'den': 'MKD',
  'kr': 'NOK',
  'zł': 'PLN',
}

const redir = {
  'https://es-us.flixbus.com': 'https://shop.flixbus.com',
  'https://fr.flixbus.be': 'https://shop.flixbus.be',
  'https://fr.flixbus.ch': 'https://shop.flixbus.ch',
  'https://it.flixbus.ch': 'https://shop.flixbus.ch',
  'https://tr.flixbus.com': 'https://shop.global.flixbus.com',
}

async function flixPage (domain, path) {
  var domain = domain[0].replace('www', 'shop')
  if (!domain.match(/shop\./)) {
    domain = domain.replace('https://', 'https://shop.')
  }
  const url = domain + path
  //console.log('URL: %s', url)
  const res = await fetch(url)

  if (res.status !== 200) {
    console.log('Error fetching [503]: %s', url)
  }
  return res.text()
}

async function flixPagePrice (domain) {
  const html = await flixPage(domain, searchUrl)
  if (!html) {
    return null
  }
  const $ = cheerio.load(html)

  //console.log(html)
  var symbol = $('.currency-switch span.active').text()

  const conn = $('#results-group-container-direct > div:nth-child('+opts.connection+')')
  const priceSrc = $('div.col-xs-12.col-sm-4.col-md-12.col-lg-5.total > span', conn).text()
  var match = priceSrc.match(/^([0-9.,\s]+)(.+)$/)

  if (!match) {
    // symbol on beginning
    match = priceSrc.match(/^([^\d]+)([0-9.,\s]+)$/)
    if (!match) {
      return null
      //throw new Error('price not recognized: ' + priceSrc)
    }
    match = [ null, match[2], match[1] ]
  }
  
  var price = match[1].replace(' ', '').trim()
  if (price.match(/,/) && price.match(/\./)) {
    price = price.replace('.', '')
  }
  price = price.replace(',', '.')

  if (!symbol) {
    symbol = currencies[match[2]]
  }
  if (!symbol) {
    throw new Error('unknown symbol: ' + match[2])
  }
  return [ price, symbol ]
}

async function flixDomains () {
  const res = await fetch(rootUrl)
  const html = await res.text()
  const $ = cheerio.load(html)
  var domains = []
  $('.language-switcher li').each((i, li) => {
    const title = $(li).text().trim()
    const url = $('a', li).attr('href')
    domains.push([ url, title ])
  })
  return domains
}

function convert (price, symbol) {
  const rate = rates.rates[symbol]
  if (!rate) {
    return null
  }
  const p = (price/rate) * rates.rates[compareCurrency]
  return p
}

async function main () {

  console.log('Getting all FlixBus domains ..')
  const domains = await flixDomains()
  console.log('Fetched %i domains', domains.length)
  console.log('Discovering prices for connection: %s', JSON.stringify(opts, null, 2))

  const bar = new ProgressBar('[:bar]', { total: domains.length })
  const table = new Table({
    head: [ 'domain', 'lang', 'symbol', 'price', 'converted', 'diff' ]
  })
  var out = await Promise.map(domains, async (domain) => {
    if (redir[domain[0]]) {
      domain[0] = redir[domain[0]]
    }
    //console.log('Checking domain: %s [%s]', domain[0], domain[1])
    const ret = await flixPagePrice(domain)
    if (!ret) {
      console.log('bad output = %s', ret)
      bar.tick()
      return [ null, null, null ]
    }
    const [ price, symbol ] = ret
    const converted = convert(price, symbol)
    //console.log('Price: %s %s == %s', price, symbol, converted)
    bar.tick()
    return [ symbol, price, converted, domain ]
  })
  /*out = out.filter((x) => {
    return x[0] !== null
  })*/
  out = out.sort((x, y) => {
    return x[2] > y[2] ? 1 : -1
  })

  let first = null
  out.forEach(x => {
    if (x[1] === null) return null
    let perc = first ? (x[2]/(first/100))-100 : null
    table.push([ x[3][0], x[3][1], x[0], x[1], x[2].toFixed(2) + ' ' + compareCurrency, perc ? perc.toFixed(2) + '%' : 'n/a' ])
    if (!first) {
      first = x[2]
    }
  })

  console.log(table.toString())
}

const lo = process.argv.slice(2)
if (lo.length === 5) {
  opts.departure = lo[0]
  opts.arrival = lo[1]
  opts.date = lo[2]
  opts.adults = lo[3]
  opts.connection = lo[4]
}

main()
