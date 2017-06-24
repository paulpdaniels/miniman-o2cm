/**
 *  Created - 4/7/2017
 *  @author Paul Daniels
 */

const cheerio = require('cheerio');
const crypto = require('crypto');
const formUrlEncoded = require('form-urlencoded');
const fs = require('fs');
const got = require('got');
const {got$} = require('./util/got-rx');
const querystring = require('querystring');
const Rx = require('rxjs');
const cluster = require('cluster');
const R = require('ramda');


const writeFileAsObservable = Rx.Observable.bindNodeCallback(fs.writeFile);
const readFileAsObservable = Rx.Observable.bindNodeCallback(fs.readFile);

const O2CM_BASE_URL = 'http://www.o2cm.com/results/';

const disposableTimer = () => {
  const start = process.hrtime();
  return {
    unsubscribe() {
      const diff = process.hrtime(start);
      console.log(`Benchmark took ${diff[0]} seconds`)
    }
  }
};

// First we need to check if our hash store already exists
const hash$ = readFileAsObservable('.hash.txt');

// Kick things off by getting the root of o2cm results
const homePage$ = Rx.Observable.fromPromise(got(O2CM_BASE_URL));

// Hooray some event links!
const links$ = homePage$
  .pluck('body')
  .map(cheerio.load)
  .map(extractLinks)
  .publishLast();

// Time to resolve those links into something we can use
// This make take a while...
const pages$ = Rx.Observable.using(disposableTimer, () => links$
  .flatMap(x => x)
  .flatMap(fetchEventPage, 10)
  .pluck('body')
  .map(cheerio.load)
  .flatMap($ =>
    $('#placement')
      .find('form > table:nth-child(2) a')
      .map((_, el) => $(el).attr('href'))
      .get()
  )
  .map(url => querystring.parse(url.split('?')[1]))
  .flatMap(
    ({event, heatid}) => fetchScorePage(event, heatid, 0),
    ({event, heatid}, {body}) => {
      const $ = cheerio.load(body);

      const selCount = $('#selCount').find('> option')
        .map((_, el) => $(el).attr('value'))
        .get();

      return Rx.Observable.concat(
        // We are already on the first page so go ahead and save it
        writeFileAsObservable(`./cache/${event}_${heatid}_0.html`, body),
        // Load the other pages
        Rx.Observable.from(selCount)
          .skip(1)
          .flatMap(
            (value) => fetchScorePage(event, heatid, value),
            (value, resp) => writeFileAsObservable(`./cache/${event}_${heatid}_${value}.html`, resp.body)
          )
          .mergeAll()
      );

    }, 10)
  .mergeAll()
  .reduce(R.inc, 0));

Rx.Observable.zip(
  hash$.catch(() => Rx.Observable.of('')),
  links$,
  (hash, links) => ([hash, sha1(links)])
)
  .flatMap(([original, current]) =>
      Rx.Observable.if(
        () => original === current,
        Rx.Observable.of(0),
        pages$
      ),
    ([, current], count) => writeFileAsObservable('.hash.txt', current).mapTo(count)
  )
  .mergeAll()
  .subscribe(
    x => console.log(`Wrote: ${x} files`),
    err => console.warn('Error writing files', err)
  );

links$.connect();

function fetchScorePage(event, heatid, value) {
  const obj = {
    event,
    heatid,
    selCount: value
  };

  console.log(`event=${event} fetch heat=${heatid}`);

  return got$(O2CM_BASE_URL + 'scoresheet3.asp?' + querystring.stringify(obj), {
    body: formUrlEncoded(obj),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
    .catch(defaultErrorHandler)
}

function fetchEventPage(link) {
  const event = link.split('=')[1];

  console.log(`fetch event=${event}`);

  const obj = {
    submit: 'OK',
    event: event,
    selDiv: '',
    selAge: '',
    selSkl: '',
    selSty: '',
    selEnt: ''
  };

  return got$(O2CM_BASE_URL + `event3.asp?event=${event}`, {
    body: formUrlEncoded(obj),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }).catch(defaultErrorHandler);
}

function defaultErrorHandler({statusCode, message, host, path}) {
  console.log('Error processing request',
    JSON.stringify({statusCode, message, host, path}));
  return Rx.Observable.empty();
}

function extractLinks(rootEl) {
  const $ = rootEl;
  return $('body td > a')
    .map((_, el) => $(el).attr('href'))
    .get();
}

function sha1(keys) {
  return crypto.createHash('sha1').update(JSON.stringify(keys)).digest('hex');
}

