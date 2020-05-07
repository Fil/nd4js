'use strict';

/* This file is part of ND.JS.
 *
 * ND.JS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ND.JS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ND.JS. If not, see <http://www.gnu.org/licenses/>.
 */

import {IS_LITTLE_ENDIAN} from '../io'

const val =   Float64Array.of(NaN),
     bits = new Int32Array(val.buffer);

/*DEBUG*/ if( bits.length !== 2 ) throw new Error('Assertion failed.');

export function nextUp(x)
{
  if( ! (x < Infinity) ) // <- handles NaN and Infinity
    return x;

  val[0] = x;

  const i = 1-IS_LITTLE_ENDIAN,
        j = 1*IS_LITTLE_ENDIAN;

  if( x >= 0 )
  {
    bits[j] += -1 === bits[i];
    bits[i] +=  1;
  }
  else {
    bits[j] -= 0 === bits[i];
    bits[i] -= 1;
  }

  return val[0];
};