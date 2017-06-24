/**
 *  Created - 4/8/2017
 *  @author Paul Daniels
 */
const fs = require('fs');
const Rx = require('rxjs');
const cheerio = require('cheerio');
const R = require('ramda');

const readFileObservable = Rx.Observable.bindNodeCallback(fs.readFile);
const writeFileObservable = Rx.Observable.bindNodeCallback(fs.writeFile);
const readDirObservable = Rx.Observable.bindNodeCallback(fs.readdir);

readDirObservable('./cache')
  // Flatten the array
  .flatMap(R.identity)
  // Process each of the files
  .flatMap(fileName => {
    const fileNameWithoutExt = fileName.split('.')[0];

    return readFileObservable('./cache/' + fileName)
      .map(cheerio.load)
      .let(processFile)
      .map(convertToCypherQuery)
      // .flatMap(uploadToDb)
      // .map(R.unary(JSON.stringify))
      // .flatMap(R.unary(R.partial(writeFileObservable, ['./processed/' + fileNameWithoutExt + '.json'])));
  }, 10)
  // .scan(R.inc, 0)
  .subscribe({
    next: count => count % 10 === 0 && console.log(`Processed ${count} files`),
    completed: () => console.log('Done Processing')
  });

function convertToCypherQuery({results, judges, couples}) {

  const createOrUpdatePerson = (name) => `MERGE(:Person {name: '${name}'})`;
  const createOrUpdateCouple = (couple) => `MERGE(:Person {name: '${couple[0]}')-[:MEMBER_OF]->(:Couple)<-[:MEMBER_OF]-(:Person {name: '${couple[1]}'})`;

  const judgesQuery = R.values(R.map(
    createOrUpdatePerson
  )(judges));

  const couplesQuery = R.values(R.map(
    createOrUpdateCouple
  )(couples));


  const combinedQuery = R.join('\n')(R.concat(judgesQuery, couplesQuery));

  return combinedQuery;
}

function processFile(source) {

  return source.map(html => {
    const $ = html;
    // Array of tables containing results objects
    const tables = $('body > table.t1n').get();
    const results = [];

    for (let table of R.init(tables)) {
      let tr = $(table).find('tr');
      // First row is the name of the dance
      const name = $(tr).first().find('td.h3').text();

      // Move the iterator
      tr = $(tr).next();

      // The summary is a special block that will need its own handling
      if (name === 'Summary') {

        const dances = R.init(
          $(tr).first()
            .find('td.t1b')
            .map((_, el) => $(el).text())
            .get()
        );

        // Move the iterator again
        tr = $(tr).next();

        // Each subsequent line is a competitor
        const competitors = $(tr).map((_, row) => {
          // The first column is competitor id
          const competitor = $('td.t1b', row).text();

          // Next retrieve the same number of columns as we have judges
          const marks = $('td', row).slice(1, 1 + dances.length)
            .map((_, m) => Number($(m, row).text()))
            .get();

          // Finally the place is the last item in the column
          const place = $('td', row)
            .last()
            .text();

          return {competitor, marks, place};
        }).get();

        results.push({
          name,
          dances,
          competitors
        });

      } else {

        // Second row is the judges ids
        const judges = R.compose(R.init, R.tail)(
          $(tr).first()
            .find('td.t1b')
            .map((_, el) => $(el).text())
            .get()
        );

        // Move the iterator again
        tr = $(tr).next();

        // Each subsequent line is a competitor
        const competitors = $(tr).map((_, row) => {
          // The first column is competitor id
          const competitor = $('td.t1b', row).text();

          // Next retrieve the same number of columns as we have judges
          const marks = $('td', row).slice(1, 1 + judges.length)
            // Convert that mark into a number
            .map((_, m) => Number($(m, row).text()))
            .get();

          // Finally the place is the second to last item in the column
          const place = $('td', row)
            .last()
            .prev()
            .text();

          return {competitor, marks, place};
        }).get();

        results.push({
          name,
          judges,
          competitors
        });
      }
    }

    // The last table is full of judges and couples
    const couplesAndJudges = R.last(tables);
    let state;

    const r = $('tr', couplesAndJudges).map((index, row) => {
      return $('td a,td', row).get();
    }).get().map(x => $(x).text().trim()).filter(x => !!x);

    // Split out the two datasets
    const [left, right] = R.splitWhen(R.equals('Judges'))(r);

    // Couples contain artifacts that must be removed
    const couples =
      R.compose(
        R.fromPairs,
        R.lift(val => [R.head(val), R.tail(val)]),
        R.splitEvery(3),
        R.addIndex(R.reject)((val, idx) => idx % 4 === 1),
        R.tail
      )(left);

    const judges =
      R.compose(
        R.fromPairs,
        R.splitEvery(2),
        R.tail
      )(right);


    return {results, judges, couples};
  });
}