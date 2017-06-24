/**
 *  Created - 5/24/2017
 *  @author Paul Daniels
 */
const Rx = require('rxjs');
const got = require('got');


module.export = {
  got$(...args) {
    return Rx.Observable.defer(() => got.apply(got, args))
  }
};